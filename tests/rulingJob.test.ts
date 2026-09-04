import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProduceRulingOutcome } from "../src/ruling/produceRuling";
import type { FinalizeRulingJobParams, FinalizeRulingJobResult } from "../src/ruling/rulingJobRepository";

const produceRuling = vi.fn<(question: string) => Promise<ProduceRulingOutcome>>();
vi.mock("../src/ruling/produceRuling", () => ({
  produceRuling: (question: string) => produceRuling(question),
}));

const markRunning = vi.fn<(id: string, workerId: string) => void>();
const markNotified = vi.fn<(id: string) => void>();
const finalizeRulingJob =
  vi.fn<(id: string, params: FinalizeRulingJobParams) => FinalizeRulingJobResult>();
const pruneOldJobs = vi.fn<(retentionMs: number) => void>();
const renewHeartbeat = vi.fn<(id: string, workerId: string) => void>();
vi.mock("../src/ruling/rulingJobRepository", () => ({
  markRunning: (id: string, workerId: string) => markRunning(id, workerId),
  markNotified: (id: string) => markNotified(id),
  finalizeRulingJob: (id: string, params: FinalizeRulingJobParams) => finalizeRulingJob(id, params),
  pruneOldJobs: (retentionMs: number) => pruneOldJobs(retentionMs),
  renewHeartbeat: (id: string, workerId: string) => renewHeartbeat(id, workerId),
}));

const getToken = vi.fn<(deviceId: string) => string | null>();
const deleteToken = vi.fn<(deviceId: string) => void>();
vi.mock("../src/push/pushTokenRepository", () => ({
  getToken: (deviceId: string) => getToken(deviceId),
  deleteToken: (deviceId: string) => deleteToken(deviceId),
}));

const sendPushNotification =
  vi.fn<(params: { token: string; title: string; body: string; data: Record<string, string> }) => Promise<{ ok: boolean; shouldRemoveToken: boolean }>>();
vi.mock("../src/push/fcm", () => ({
  sendPushNotification: (params: { token: string; title: string; body: string; data: Record<string, string> }) =>
    sendPushNotification(params),
}));

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function okOutcome(conclusion = "結論です"): ProduceRulingOutcome {
  return {
    status: "ok",
    result: { conclusion, explanation: "説明", steps: [], confidence: "high", cards: [], sources: [] },
  };
}

const WON_NOT_REFUNDED: FinalizeRulingJobResult = { won: true, refunded: false, deviceId: null };

describe("rulingJob", () => {
  beforeEach(() => {
    vi.resetModules();
    produceRuling.mockReset();
    markRunning.mockReset();
    markNotified.mockReset();
    finalizeRulingJob.mockReset();
    finalizeRulingJob.mockReturnValue(WON_NOT_REFUNDED);
    pruneOldJobs.mockReset();
    renewHeartbeat.mockReset();
    getToken.mockReset();
    deleteToken.mockReset();
    sendPushNotification.mockReset();
  });

  it("開始時にmarkRunningが呼ばれる", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockImplementation(() => new Promise(() => {}));

    runRulingJobInBackground("job-1", "質問", null, null);

    expect(markRunning).toHaveBeenCalledWith("job-1", expect.any(String));
  });

  it("成功時はfinalizeRulingJobがdone/okで呼ばれ、deviceIdがなければプッシュ送信しない", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());

    runRulingJobInBackground("job-1", "質問", null, null);
    await flushMicrotasks();

    expect(finalizeRulingJob).toHaveBeenCalledWith("job-1", {
      outcome: "done",
      outcomeStatus: "ok",
      result: okOutcome().result,
    });
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("deviceIdがあってもトークン未登録ならプッシュ送信しない", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());
    getToken.mockReturnValue(null);

    runRulingJobInBackground("job-1", "質問", "device-1", null);
    await flushMicrotasks();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("トークンがあればプッシュ送信しmarkNotifiedを呼ぶ", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome("裁定の結論"));
    getToken.mockReturnValue("fcm-token-abc");
    sendPushNotification.mockResolvedValue({ ok: true, shouldRemoveToken: false });

    runRulingJobInBackground("job-1", "質問", "device-1", null);
    await flushMicrotasks();

    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ token: "fcm-token-abc", data: { jobId: "job-1", type: "ruling_result" } }),
    );
    expect(markNotified).toHaveBeenCalledWith("job-1");
    expect(deleteToken).not.toHaveBeenCalled();
  });

  it("threadIdがあればプッシュ通知のdataにthreadIdが含まれる", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome("裁定の結論"));
    getToken.mockReturnValue("fcm-token-abc");
    sendPushNotification.mockResolvedValue({ ok: true, shouldRemoveToken: false });

    runRulingJobInBackground("job-1", "質問", "device-1", "thread-1");
    await flushMicrotasks();

    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { jobId: "job-1", type: "ruling_result", threadId: "thread-1" },
      }),
    );
  });

  it("無効トークンならshouldRemoveToken指示でdeleteTokenが呼ばれる", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());
    getToken.mockReturnValue("stale-token");
    sendPushNotification.mockResolvedValue({ ok: false, shouldRemoveToken: true });

    runRulingJobInBackground("job-1", "質問", "device-1", null);
    await flushMicrotasks();

    expect(deleteToken).toHaveBeenCalledWith("device-1");
  });

  it("finalizeRulingJobが競合に負けた(won: false)場合はプッシュ通知を送らない", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());
    getToken.mockReturnValue("fcm-token-abc");
    finalizeRulingJob.mockReturnValue({ won: false });

    runRulingJobInBackground("job-1", "質問", "device-1", null);
    await flushMicrotasks();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("プッシュ通知送信が例外を投げても、確定済みのfinalizeRulingJobをfailedへ上書きしない", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());
    getToken.mockReturnValue("fcm-token-abc");
    sendPushNotification.mockRejectedValue(new Error("fcm error"));

    runRulingJobInBackground("job-1", "質問", "device-1", null);
    await flushMicrotasks();

    // done/okでの確定(1回目)のみで、failedとしての再確定は行われない。
    expect(finalizeRulingJob).toHaveBeenCalledTimes(1);
    expect(finalizeRulingJob).toHaveBeenCalledWith("job-1", {
      outcome: "done",
      outcomeStatus: "ok",
      result: okOutcome().result,
    });
  });

  it("produceRulingが例外を投げるとfinalizeRulingJobがfailedで呼ばれる", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockRejectedValue(new Error("db error"));

    runRulingJobInBackground("job-1", "質問", null, null);
    await flushMicrotasks();

    expect(finalizeRulingJob).toHaveBeenCalledWith("job-1", { outcome: "failed", error: "db error" });
  });

  it("catchハンドラ内でfinalizeRulingJob(failed)自体が例外を投げても未処理rejectionにならない", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockRejectedValue(new Error("network error"));
    finalizeRulingJob.mockImplementation(() => {
      throw new Error("db error on finalize");
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      runRulingJobInBackground("job-1", "質問", null, null);
      await flushMicrotasks();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toEqual([]);
  });

  it("finally内でpruneOldJobsが例外を投げても未処理rejectionにならず、runningCountは元に戻る", async () => {
    const { runRulingJobInBackground, getRunningJobCount } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());
    pruneOldJobs.mockImplementation(() => {
      throw new Error("prune failed");
    });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      runRulingJobInBackground("job-1", "質問", null, null);
      await flushMicrotasks();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toEqual([]);
    expect(getRunningJobCount()).toBe(0);
  });

  it("markRunningが同期的に例外を投げた場合もfinalizeRulingJobがfailedで呼ばれ、runningCountが元に戻る", async () => {
    const { runRulingJobInBackground, getRunningJobCount } = await import("../src/ruling/rulingJob");
    markRunning.mockImplementation(() => {
      throw new Error("db unavailable");
    });

    runRulingJobInBackground("job-1", "質問", null, null);

    expect(finalizeRulingJob).toHaveBeenCalledWith("job-1", { outcome: "failed", error: "db unavailable" });
    expect(getRunningJobCount()).toBe(0);
    expect(produceRuling).not.toHaveBeenCalled();
  });

  it("完了後にpruneOldJobsが呼ばれ、runningCountが元に戻る", async () => {
    const { runRulingJobInBackground, getRunningJobCount } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());

    expect(getRunningJobCount()).toBe(0);
    runRulingJobInBackground("job-1", "質問", null, null);
    expect(getRunningJobCount()).toBe(1);
    await flushMicrotasks();

    expect(getRunningJobCount()).toBe(0);
    expect(pruneOldJobs).toHaveBeenCalled();
  });

  it("startHeartbeatRenewal: 処理中のジョブのみ定期的にrenewHeartbeatが呼ばれる(完了後は呼ばれない)", async () => {
    vi.useFakeTimers();
    const { runRulingJobInBackground, startHeartbeatRenewal, stopHeartbeatRenewal } = await import(
      "../src/ruling/rulingJob"
    );
    let resolveProduceRuling: (outcome: ProduceRulingOutcome) => void = () => {};
    produceRuling.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProduceRuling = resolve;
        }),
    );

    try {
      startHeartbeatRenewal();
      runRulingJobInBackground("job-1", "質問", null, null);

      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(renewHeartbeat).toHaveBeenCalledWith("job-1", expect.any(String));

      resolveProduceRuling(okOutcome());
      await vi.runOnlyPendingTimersAsync();
      renewHeartbeat.mockClear();

      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(renewHeartbeat).not.toHaveBeenCalled();
    } finally {
      stopHeartbeatRenewal();
      vi.useRealTimers();
    }
  });

  it("produceRulingは常にquestionのみを引数に呼ばれる(Batch API廃止によりoptionsは渡さない)", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());

    runRulingJobInBackground("job-1", "質問", null, null);
    await flushMicrotasks();

    expect(produceRuling).toHaveBeenCalledWith("質問");
  });

  it("canAcceptNewJobは同時実行数が上限(既定5)に達するとfalseになる", async () => {
    const { runRulingJobInBackground, canAcceptNewJob } = await import("../src/ruling/rulingJob");
    produceRuling.mockImplementation(() => new Promise(() => {}));

    expect(canAcceptNewJob()).toBe(true);
    for (let i = 0; i < 5; i++) {
      runRulingJobInBackground(`job-${i}`, "質問", null, null);
    }

    expect(canAcceptNewJob()).toBe(false);
  });
});
