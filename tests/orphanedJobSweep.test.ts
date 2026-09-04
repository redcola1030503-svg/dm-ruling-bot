import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalizeRulingJobResult } from "../src/ruling/rulingJobRepository";

const allMock = vi.fn();
const prepareMock = vi.fn().mockReturnValue({ all: allMock });
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

type OrphanGuard =
  | { status: "pending"; createdBefore: number }
  | { status: "running"; heartbeatBefore: number; legacyCreatedBefore: number };

const finalizeOrphanedRulingJob =
  vi.fn<(id: string, guard: OrphanGuard, errorMessage: string) => FinalizeRulingJobResult>();
vi.mock("../src/ruling/rulingJobRepository", () => ({
  finalizeOrphanedRulingJob: (id: string, guard: OrphanGuard, errorMessage: string) =>
    finalizeOrphanedRulingJob(id, guard, errorMessage),
}));

describe("orphanedJobSweep", () => {
  beforeEach(() => {
    vi.resetModules();
    allMock.mockReset();
    prepareMock.mockReset();
    prepareMock.mockReturnValue({ all: allMock });
    finalizeOrphanedRulingJob.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("経過時間が閾値を超えたpendingジョブをfailedで確定する(created_atのguardを渡す)", async () => {
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([{ id: "job-1", status: "pending", created_at: Date.now() - 60 * 60 * 1000 }]);
    finalizeOrphanedRulingJob.mockReturnValue({ won: true, refunded: true, deviceId: "device-1" });

    sweepOrphanedRulingJobs();

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("heartbeat_at"));
    expect(finalizeOrphanedRulingJob).toHaveBeenCalledWith(
      "job-1",
      { status: "pending", createdBefore: expect.any(Number) },
      expect.any(String),
    );
  });

  it("heartbeatが古いrunningジョブをfailedで確定する(heartbeat_at/legacyのguardを渡す)", async () => {
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([{ id: "job-1", status: "running", created_at: Date.now() - 60 * 60 * 1000 }]);
    finalizeOrphanedRulingJob.mockReturnValue({ won: true, refunded: true, deviceId: "device-1" });

    sweepOrphanedRulingJobs();

    expect(finalizeOrphanedRulingJob).toHaveBeenCalledWith(
      "job-1",
      {
        status: "running",
        heartbeatBefore: expect.any(Number),
        legacyCreatedBefore: expect.any(Number),
      },
      expect.any(String),
    );
  });

  it("SELECT時点の判定だけに頼らず、実際の確定判断(TOCTOU競合の再検証)はfinalizeOrphanedRulingJob側のUPDATE条件に委ねる", async () => {
    // sweepOrphanedRulingJobs自身は「候補行が見つかった」ことしか知らない。
    // SELECT後に別プロセスがheartbeatを更新して正常化していた場合、
    // finalizeOrphanedRulingJob側のUPDATE条件(guard)が0件更新でwon:falseを
    // 返すことで誤確定を防ぐ設計になっている(Codexレビュー指摘)。
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([{ id: "job-1", status: "running", created_at: Date.now() - 60 * 60 * 1000 }]);
    finalizeOrphanedRulingJob.mockReturnValue({ won: false });

    sweepOrphanedRulingJobs();

    expect(finalizeOrphanedRulingJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "running" }),
      expect.any(String),
    );
  });

  it("running用の猶予期間(heartbeatあり: 5分)はpending用の猶予期間(30分)より短い閾値を使う", async () => {
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([]);
    const before = Date.now();

    sweepOrphanedRulingJobs();

    expect(allMock).toHaveBeenCalledTimes(1);
    const [pendingThreshold, leaseThreshold, legacyThreshold] = allMock.mock.calls[0] as [number, number, number];
    expect(pendingThreshold).toBeLessThan(before);
    expect(leaseThreshold).toBeLessThan(before);
    expect(leaseThreshold).toBeGreaterThan(pendingThreshold);
    // heartbeatが無い(旧デプロイ由来の)running行は、pendingと同じ猶予期間を流用する。
    expect(legacyThreshold).toBe(pendingThreshold);
  });

  it("1件のfinalizeOrphanedRulingJob失敗が後続ジョブの回収を止めない", async () => {
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([
      { id: "job-1", status: "running", created_at: Date.now() - 60 * 60 * 1000 },
      { id: "job-2", status: "running", created_at: Date.now() - 60 * 60 * 1000 },
    ]);
    finalizeOrphanedRulingJob.mockImplementation((id) => {
      if (id === "job-1") throw new Error("db error");
      return { won: true, refunded: false, deviceId: null };
    });

    expect(() => sweepOrphanedRulingJobs()).not.toThrow();

    expect(finalizeOrphanedRulingJob).toHaveBeenCalledWith("job-1", expect.anything(), expect.any(String));
    expect(finalizeOrphanedRulingJob).toHaveBeenCalledWith("job-2", expect.anything(), expect.any(String));
  });

  it("走査対象の取得自体が例外を投げても呼び出し元へ伝播しない", async () => {
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockImplementation(() => {
      throw new Error("db unavailable");
    });

    expect(() => sweepOrphanedRulingJobs()).not.toThrow();
    expect(finalizeOrphanedRulingJob).not.toHaveBeenCalled();
  });

  it("対象ジョブが無ければfinalizeOrphanedRulingJobを呼ばない", async () => {
    const { sweepOrphanedRulingJobs } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([]);

    sweepOrphanedRulingJobs();

    expect(finalizeOrphanedRulingJob).not.toHaveBeenCalled();
  });

  it("startOrphanedJobSweep: 起動時に1回実行し、その後は定期的に再実行する", async () => {
    vi.useFakeTimers();
    const { startOrphanedJobSweep, stopOrphanedJobSweep } = await import("../src/ruling/orphanedJobSweep");
    allMock.mockReturnValue([]);

    try {
      startOrphanedJobSweep();
      expect(prepareMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(prepareMock).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(prepareMock).toHaveBeenCalledTimes(3);
    } finally {
      stopOrphanedJobSweep();
    }
  });
});
