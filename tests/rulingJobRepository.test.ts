import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { createJob, getJobsByThread, deleteJobsByThread, pruneOldJobs, migrateLegacyCorrectionTitlesInResultJson } =
  await import("../src/ruling/rulingJobRepository");

describe("rulingJobRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("createJob: thread_idを含めてINSERTする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    createJob("job-1", "質問", "device-1", "thread-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("thread_id"));
    expect(runFn).toHaveBeenCalledWith("job-1", "device-1", "質問", "thread-1", expect.any(Number));
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
});
