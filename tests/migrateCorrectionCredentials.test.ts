import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const execMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: {
    prepare: (...args: unknown[]) => prepareMock(...args),
    exec: (...args: unknown[]) => execMock(...args),
  },
}));

const migrateLegacyCorrectionTitlesInResultJson = vi
  .fn()
  .mockReturnValue({ migrated: 0, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
vi.mock("../src/ruling/rulingJobRepository", () => ({
  migrateLegacyCorrectionTitlesInResultJson: (knownJudgeIds: readonly string[]) =>
    migrateLegacyCorrectionTitlesInResultJson(knownJudgeIds),
}));

const { migrateCorrectionCredentials } = await import("../src/corrections/repository");

function stubStatement(sql: string, changes: number) {
  return { run: vi.fn().mockReturnValue({ changes }) };
}

function stubKnownJudgeIdsQuery(sql: string, judgeIds: string[]) {
  if (sql.includes("SELECT id AS judge_id FROM judge UNION")) {
    return { all: vi.fn().mockReturnValue(judgeIds.map((judge_id) => ({ judge_id }))) };
  }
  return null;
}

describe("migrateCorrectionCredentials", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    execMock.mockReset();
    migrateLegacyCorrectionTitlesInResultJson
      .mockReset()
      .mockReturnValue({ migrated: 0, unresolvedMarkerCount: 0, invalidJsonCount: 0, possibleKnownIdCollisionCount: 0 });
  });

  it(
    "BEGIN→(セッション失効→corrected_by移行→source_reference_stat移行→ruling_job.result_json移行)" +
      "→COMMITの順で実行し、各件数を返す(T008: 生セッショントークンの露出・漏洩titleの是正)",
    () => {
      prepareMock.mockImplementation((sql: string) => {
        if (sql.includes("DELETE FROM judge_session")) return stubStatement(sql, 2);
        if (sql.includes("UPDATE correction SET corrected_by")) return stubStatement(sql, 3);
        if (sql.includes("UPDATE source_reference_stat")) return stubStatement(sql, 1);
        const knownJudgeIdsStmt = stubKnownJudgeIdsQuery(sql, ["J001"]);
        if (knownJudgeIdsStmt) return knownJudgeIdsStmt;
        throw new Error(`unexpected sql: ${sql}`);
      });
      migrateLegacyCorrectionTitlesInResultJson.mockReturnValue({
        migrated: 4,
        unresolvedMarkerCount: 0,
        invalidJsonCount: 0,
        possibleKnownIdCollisionCount: 0,
      });

      const summary = migrateCorrectionCredentials();

      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "COMMIT"]);
      expect(summary).toEqual({
        revokedSessions: 2,
        migratedCorrections: 3,
        migratedSourceReferenceStats: 1,
        migratedRulingJobResultJson: 4,
        unresolvedRulingJobResultJsonMarkerCount: 0,
        invalidRulingJobResultJsonCount: 0,
        possibleKnownIdCollisionRulingJobResultJsonCount: 0,
      });
      // ラベルの表記揺れに依存しない監査のため、judge/correctionから集めた
      // 既知のジャッジID値が正しく引き渡されること(Codexレビュー指摘、2026-09-04)。
      expect(migrateLegacyCorrectionTitlesInResultJson).toHaveBeenCalledWith(["J001"]);
      // 失効(judge_sessionの削除)がcorrected_byの上書きより先に実行されること
      // (先に上書きすると、漏洩トークンとcorrected_byの対応が取れず失効できなくなる)。
      const sqls = prepareMock.mock.calls.map(([sql]) => sql as string);
      const deleteIndex = sqls.findIndex((sql) => sql.includes("DELETE FROM judge_session"));
      const updateIndex = sqls.findIndex((sql) => sql.includes("UPDATE correction SET corrected_by"));
      expect(deleteIndex).toBeGreaterThanOrEqual(0);
      expect(updateIndex).toBeGreaterThan(deleteIndex);
    },
  );

  it("ruling_job.result_jsonの未解決件数(マーカー残存・解析失敗)をそれぞれ別カウントでsummaryへ伝播する(呼び出し元が黙って成功扱いにしないため)", () => {
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes("DELETE FROM judge_session")) return stubStatement(sql, 0);
      if (sql.includes("UPDATE correction SET corrected_by")) return stubStatement(sql, 0);
      if (sql.includes("UPDATE source_reference_stat")) return stubStatement(sql, 0);
      const knownJudgeIdsStmt = stubKnownJudgeIdsQuery(sql, []);
      if (knownJudgeIdsStmt) return knownJudgeIdsStmt;
      throw new Error(`unexpected sql: ${sql}`);
    });
    migrateLegacyCorrectionTitlesInResultJson.mockReturnValue({
      migrated: 0,
      unresolvedMarkerCount: 1,
      invalidJsonCount: 2,
      possibleKnownIdCollisionCount: 3,
    });

    const summary = migrateCorrectionCredentials();

    expect(summary.unresolvedRulingJobResultJsonMarkerCount).toBe(1);
    expect(summary.invalidRulingJobResultJsonCount).toBe(2);
    expect(summary.possibleKnownIdCollisionRulingJobResultJsonCount).toBe(3);
  });

  it("途中で失敗した場合はROLLBACKし、エラーを再送出する", () => {
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes("DELETE FROM judge_session")) return stubStatement(sql, 0);
      if (sql.includes("UPDATE correction SET corrected_by")) {
        return {
          run: () => {
            throw new Error("db error");
          },
        };
      }
      return stubStatement(sql, 0);
    });

    expect(() => migrateCorrectionCredentials()).toThrow("db error");
    expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "ROLLBACK"]);
  });
});
