import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const execMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args), exec: (...args: unknown[]) => execMock(...args) },
}));

const decrementMonthlyUsage = vi.fn<(deviceId: string, monthKey: string) => void>();
vi.mock("../src/billing/deviceMonthlyUsageRepository", () => ({
  decrementMonthlyUsage: (deviceId: string, monthKey: string) => decrementMonthlyUsage(deviceId, monthKey),
}));

const {
  createJob,
  getJobsByThread,
  deleteJobsByThread,
  pruneOldJobs,
  migrateLegacyCorrectionTitlesInResultJson,
  finalizeRulingJob,
  finalizeOrphanedRulingJob,
  markRunning,
  renewHeartbeat,
} = await import("../src/ruling/rulingJobRepository");

describe("rulingJobRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    execMock.mockReset();
    decrementMonthlyUsage.mockReset();
  });

  it("createJob: thread_id・usage_month_keyを含めてINSERTする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    createJob("job-1", "質問", "device-1", "thread-1", "2026-09");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("thread_id"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("usage_month_key"));
    expect(runFn).toHaveBeenCalledWith("job-1", "device-1", "質問", "thread-1", "2026-09", expect.any(Number));
  });

  it("getJobsByThread: thread_idで絞り込みcreated_at昇順で取得する", () => {
    const allFn = vi.fn().mockReturnValue([]);
    prepareMock.mockReturnValue({ all: allFn });

    getJobsByThread("thread-1");

    expect(prepareMock).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE thread_id = \?[\s\S]*ORDER BY created_at ASC/),
    );
    expect(allFn).toHaveBeenCalledWith("thread-1");
  });

  it("deleteJobsByThread: thread_idで絞り込みDELETEする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    deleteJobsByThread("thread-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("WHERE thread_id = ?"));
    expect(runFn).toHaveBeenCalledWith("thread-1");
  });

  it("pruneOldJobs: thread_id IS NULLの孤立ジョブのみを削除対象にする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    pruneOldJobs(1000);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("thread_id IS NULL"));
    expect(runFn).toHaveBeenCalledWith(expect.any(Number));
  });

  describe("markRunning/renewHeartbeat(T012 Review 8: worker_id/heartbeat_atリース)", () => {
    it("markRunning: status・started_atに加えてworker_id・heartbeat_atも設定する", () => {
      const runFn = vi.fn();
      prepareMock.mockReturnValue({ run: runFn });

      markRunning("job-1", "worker-abc");

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("worker_id"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at"));
      expect(runFn).toHaveBeenCalledWith(expect.any(Number), "worker-abc", expect.any(Number), "job-1");
    });

    it("renewHeartbeat: 自分のworker_idかつrunning状態のジョブのみを対象にUPDATEする", () => {
      const runFn = vi.fn();
      prepareMock.mockReturnValue({ run: runFn });

      renewHeartbeat("job-1", "worker-abc");

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("worker_id = ?"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("status = 'running'"));
      expect(runFn).toHaveBeenCalledWith(expect.any(Number), "job-1", "worker-abc");
    });
  });

  describe("migrateLegacyCorrectionTitlesInResultJson(T008)", () => {
    it("result_json内の旧title(ジャッジID入り)をjudgeIdを含まない表記へ置き換えて保存する", () => {
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        sources: [{ title: "過去の訂正事例(ジャッジID: J001)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const migrated = migrateLegacyCorrectionTitlesInResultJson();

      expect(migrated).toBe(1);
      expect(runFn).toHaveBeenCalledWith(
        expect.stringContaining("過去の訂正事例(公認ジャッジによる記録)"),
        "job-1",
      );
      expect(runFn.mock.calls[0][0]).not.toContain("J001");
    });

    it("コロン直後にスペースが無い旧title形式(本番で実際に確認された形式)も置き換える", () => {
      // 2026-09-04、本番DBの読み取り専用クエリでこの形式(スペース無し)の
      // 移行漏れを確認・修正した回帰テスト(実際のjudgeIdはここには記載しない)。
      const legacyResultJson = JSON.stringify({
        conclusion: "結論",
        sources: [{ title: "過去の訂正事例(ジャッジID:J001)", url: "" }],
      });
      const allFn = vi.fn().mockReturnValue([{ id: "job-1", result_json: legacyResultJson }]);
      const runFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: allFn };
        return { run: runFn };
      });

      const migrated = migrateLegacyCorrectionTitlesInResultJson();

      expect(migrated).toBe(1);
      expect(runFn.mock.calls[0][0]).not.toContain("J001");
    });

    it("旧title形式を含まないジョブは対象外(SELECT自体が絞り込む)なので、そのままUPDATEを呼ばない", () => {
      // WHERE result_json LIKE '%ジャッジID:%'で絞り込み済みの想定のため、
      // SELECTが0件を返せばUPDATEは一切呼ばれない。
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT id, result_json")) return { all: vi.fn().mockReturnValue([]) };
        return { run: vi.fn() };
      });

      expect(migrateLegacyCorrectionTitlesInResultJson()).toBe(0);
    });
  });

  describe("finalizeRulingJob(T010)", () => {
    type StubOptions = {
      // undefined(省略)= 既定値を使う。null = 行が存在しない(SELECTがundefinedを返す)。
      existing?: { device_id: string | null; usage_month_key: string | null } | null;
      changes?: number;
    };

    function stubDb({ existing, changes = 1 }: StubOptions = {}) {
      const resolvedExisting = existing === undefined ? { device_id: "device-1", usage_month_key: "2026-09" } : existing;
      const selectFn = vi.fn().mockReturnValue(resolvedExisting ?? undefined);
      const updateStatusRunFn = vi.fn().mockReturnValue({ changes });
      const updateRefundedAtRunFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT device_id, usage_month_key")) return { get: selectFn };
        if (sql.includes("SET refunded_at")) return { run: updateRefundedAtRunFn };
        return { run: updateStatusRunFn };
      });
      return { selectFn, updateStatusRunFn, updateRefundedAtRunFn };
    }

    it("done/okは返金対象外(usage_month_keyがあってもdecrementMonthlyUsageを呼ばない)", () => {
      const { updateRefundedAtRunFn } = stubDb();

      const result = finalizeRulingJob("job-1", {
        outcome: "done",
        outcomeStatus: "ok",
        result: { conclusion: "結論", explanation: "", steps: [], confidence: "high", cards: [], sources: [] },
      });

      expect(result).toEqual({ won: true, refunded: false, deviceId: "device-1" });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
      expect(updateRefundedAtRunFn).not.toHaveBeenCalled();
      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "COMMIT"]);
    });

    it("done/evidence_errorは返金対象(usage_month_key・device_idで減算し、refunded_atを更新する)", () => {
      const { updateRefundedAtRunFn } = stubDb();

      const result = finalizeRulingJob("job-1", {
        outcome: "done",
        outcomeStatus: "evidence_error",
        result: { conclusion: "結論", explanation: "", steps: [], confidence: "low", cards: [], sources: [] },
      });

      expect(result).toEqual({ won: true, refunded: true, deviceId: "device-1" });
      expect(decrementMonthlyUsage).toHaveBeenCalledWith("device-1", "2026-09");
      expect(updateRefundedAtRunFn).toHaveBeenCalledWith(expect.any(Number), "job-1");
    });

    it("failed(produceRuling自体のreject)も返金対象に含める", () => {
      stubDb();

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "network error" });

      expect(result).toEqual({ won: true, refunded: true, deviceId: "device-1" });
      expect(decrementMonthlyUsage).toHaveBeenCalledWith("device-1", "2026-09");
    });

    it("usage_month_keyがnull(購読中等、無料枠を消費していない)場合は返金しない", () => {
      stubDb({ existing: { device_id: "device-1", usage_month_key: null } });

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "network error" });

      expect(result).toEqual({ won: true, refunded: false, deviceId: "device-1" });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
    });

    it("更新件数0件(既に他の経路で確定済み)ならwon:falseを返し、返金処理をしない", () => {
      stubDb({ changes: 0 });

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "timeout" });

      expect(result).toEqual({ won: false });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "COMMIT"]);
    });

    it("ジョブ行自体が存在しない(スレッド削除で物理削除済み等)場合もwon:falseを返す", () => {
      stubDb({ existing: null });

      const result = finalizeRulingJob("job-1", { outcome: "failed", error: "timeout" });

      expect(result).toEqual({ won: false });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
    });

    it("DB例外が発生した場合はROLLBACKして例外を再送出する", () => {
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT device_id, usage_month_key")) {
          return { get: () => ({ device_id: "device-1", usage_month_key: "2026-09" }) };
        }
        return {
          run: () => {
            throw new Error("db error");
          },
        };
      });

      expect(() => finalizeRulingJob("job-1", { outcome: "failed", error: "timeout" })).toThrow("db error");
      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "ROLLBACK"]);
    });
  });

  describe("finalizeOrphanedRulingJob(T012 Review 8フォローアップ: TOCTOU競合対策)", () => {
    function stubOrphanDb({ changes = 1 }: { changes?: number } = {}) {
      const selectFn = vi.fn().mockReturnValue({ device_id: "device-1", usage_month_key: "2026-09" });
      const updateRunFn = vi.fn().mockReturnValue({ changes });
      const refundedAtRunFn = vi.fn();
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT device_id, usage_month_key")) return { get: selectFn };
        if (sql.includes("SET refunded_at")) return { run: refundedAtRunFn };
        return { run: updateRunFn };
      });
      return { updateRunFn, refundedAtRunFn };
    }

    it("pending: UPDATE自体にcreated_at鮮度条件を埋め込む", () => {
      const { updateRunFn } = stubOrphanDb();

      finalizeOrphanedRulingJob("job-1", { status: "pending", createdBefore: 1000 }, "timeout");

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("status = 'pending' AND created_at < ?"));
      expect(updateRunFn).toHaveBeenCalledWith("timeout", expect.any(Number), "job-1", 1000);
    });

    it("running: UPDATE自体にheartbeat_at鮮度条件(heartbeatあり/無しの両方)を埋め込む", () => {
      const { updateRunFn } = stubOrphanDb();

      finalizeOrphanedRulingJob(
        "job-1",
        { status: "running", heartbeatBefore: 2000, legacyCreatedBefore: 1000 },
        "timeout",
      );

      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at IS NOT NULL AND heartbeat_at < ?"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at IS NULL AND created_at < ?"));
      expect(updateRunFn).toHaveBeenCalledWith("timeout", expect.any(Number), "job-1", 2000, 1000);
    });

    it("UPDATE条件を満たさない(=他プロセスがheartbeatを更新して既に生存確認済み)場合はwon:falseを返し返金しない", () => {
      // TOCTOU対策の中核: SELECT時点で候補に見えても、UPDATE時点の鮮度条件を
      // 満たさなければchanges=0になり、誤って正常ジョブを確定・返金しない。
      const { refundedAtRunFn } = stubOrphanDb({ changes: 0 });

      const result = finalizeOrphanedRulingJob(
        "job-1",
        { status: "running", heartbeatBefore: 2000, legacyCreatedBefore: 1000 },
        "timeout",
      );

      expect(result).toEqual({ won: false });
      expect(decrementMonthlyUsage).not.toHaveBeenCalled();
      expect(refundedAtRunFn).not.toHaveBeenCalled();
    });

    it("UPDATE条件を満たす場合は確定・返金する", () => {
      stubOrphanDb({ changes: 1 });

      const result = finalizeOrphanedRulingJob(
        "job-1",
        { status: "running", heartbeatBefore: 2000, legacyCreatedBefore: 1000 },
        "timeout",
      );

      expect(result).toEqual({ won: true, refunded: true, deviceId: "device-1" });
      expect(decrementMonthlyUsage).toHaveBeenCalledWith("device-1", "2026-09");
    });
  });
});
