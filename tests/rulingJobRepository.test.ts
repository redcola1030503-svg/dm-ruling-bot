import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { createJob, getJobsByThread, deleteJobsByThread, pruneOldJobs } = await import(
  "../src/ruling/rulingJobRepository"
);

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
});
