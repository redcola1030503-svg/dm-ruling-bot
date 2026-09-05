import { describe, expect, it, vi } from "vitest";

// runFindUnresolvedJobIds()は依存(find)を引数で受け取る設計のため、実際の
// findUnresolvedLegacyCorrectionTitleJobIds(node:sqliteへ接続する../config/db経由)は
// 不要。スクリプトのモジュールを読み込むだけでDB接続チェーンが評価されるのを
// 避ける(migrateCorrectionCredentials.script.test.tsと同じ理由。実装ファイル側は
// 型のみ静的importし、実装は`require.main === module`内でrequireする設計に
// なっているため、このvi.mockは実行時には影響しないが念のため維持する)。
vi.mock("../src/ruling/rulingJobRepository", () => ({
  findUnresolvedLegacyCorrectionTitleJobIds: vi.fn(),
}));

const { runFindUnresolvedJobIds } = await import("../src/scripts/findUnresolvedLegacyCorrectionTitleJobIds");

// T008: 診断専用スクリプト(jobId一覧を表示するだけ、更新は行わない)の
// 出力契約を確認する。round20〜21の専用復旧スクリプト(apply機能・検証トークン)は
// コスト対効果が見合わないと判断し撤回した経緯があるため、このスクリプトは
// 意図的にシンプルに保つ(2026-09-05)。例外の詳細を出力しない契約はround22で
// 追加した(Codexレビュー指摘: 静的importのままだと依存モジュールの評価失敗が
// そのまま出力されうる)。

describe("runFindUnresolvedJobIds", () => {
  it("対象0件の場合、件数のみ出力し終了コード0を返す", () => {
    const log = vi.fn();
    const logError = vi.fn();
    const find = vi.fn().mockReturnValue([]);

    const exitCode = runFindUnresolvedJobIds(find, log, logError);

    expect(exitCode).toBe(0);
    expect(log.mock.calls.map((call) => call[0])).toEqual(["対象行数: 0件"]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("対象が見つかった場合、件数とjobId一覧を出力する", () => {
    const log = vi.fn();
    const logError = vi.fn();
    const find = vi.fn().mockReturnValue(["job-abc", "job-def"]);

    const exitCode = runFindUnresolvedJobIds(find, log, logError);

    expect(exitCode).toBe(0);
    expect(log.mock.calls.map((call) => call[0])).toEqual(["対象行数: 2件", "jobId: job-abc", "jobId: job-def"]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("find呼び出しが例外を投げた場合、例外の詳細を一切出力せず終了コード1を返す(下位層の例外がjobId等を含みうるため)", () => {
    const log = vi.fn();
    const logError = vi.fn();
    const find = vi.fn().mockImplementation(() => {
      throw new Error("some internal detail including job-abc123 and raw judge id JUDGE-SECRET-999");
    });

    const exitCode = runFindUnresolvedJobIds(find, log, logError);

    expect(exitCode).toBe(1);
    expect(log).not.toHaveBeenCalled();
    expect(logError.mock.calls.map((call) => call[0])).toEqual([
      "診断処理中に例外が発生しました。原因の詳細はこのスクリプトの出力には含めません。本番DBの状態を直接確認してください。",
    ]);
  });
});
