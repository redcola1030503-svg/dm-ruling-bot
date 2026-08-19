import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProduceRulingOutcome } from "../src/ruling/produceRuling";
import type { RulingResult } from "../src/ruling/types";

const produceRuling = vi.fn<(question: string) => Promise<ProduceRulingOutcome>>();
vi.mock("../src/ruling/produceRuling", () => ({
  produceRuling: (question: string) => produceRuling(question),
}));

const markRunning = vi.fn<(id: string) => void>();
const markDone = vi.fn<(id: string, outcomeStatus: string, result: RulingResult) => void>();
const markFailed = vi.fn<(id: string, error: string) => void>();
const markNotified = vi.fn<(id: string) => void>();
const pruneOldJobs = vi.fn<(retentionMs: number) => void>();
vi.mock("../src/ruling/rulingJobRepository", () => ({
  markRunning: (id: string) => markRunning(id),
  markDone: (id: string, outcomeStatus: string, result: RulingResult) => markDone(id, outcomeStatus, result),
  markFailed: (id: string, error: string) => markFailed(id, error),
  markNotified: (id: string) => markNotified(id),
  pruneOldJobs: (retentionMs: number) => pruneOldJobs(retentionMs),
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

describe("rulingJob", () => {
  beforeEach(() => {
    vi.resetModules();
    produceRuling.mockReset();
    markRunning.mockReset();
    markDone.mockReset();
    markFailed.mockReset();
    markNotified.mockReset();
    pruneOldJobs.mockReset();
    getToken.mockReset();
    deleteToken.mockReset();
    sendPushNotification.mockReset();
  });

  it("開始時にmarkRunningが呼ばれる", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockImplementation(() => new Promise(() => {}));

    runRulingJobInBackground("job-1", "質問", null, null);

    expect(markRunning).toHaveBeenCalledWith("job-1");
  });

  it("成功時はmarkDoneが呼ばれ、deviceIdがなければプッシュ送信しない", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockResolvedValue(okOutcome());

    runRulingJobInBackground("job-1", "質問", null, null);
    await flushMicrotasks();

    expect(markDone).toHaveBeenCalledWith("job-1", "ok", okOutcome().result);
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

  it("produceRulingが例外を投げるとmarkFailedが呼ばれる", async () => {
    const { runRulingJobInBackground } = await import("../src/ruling/rulingJob");
    produceRuling.mockRejectedValue(new Error("db error"));

    runRulingJobInBackground("job-1", "質問", null, null);
    await flushMicrotasks();

    expect(markFailed).toHaveBeenCalledWith("job-1", "db error");
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
