import { describe, expect, it, vi } from "vitest";
import type { CorrectionCredentialMigrationSummary } from "../src/corrections/repository";

// runMigration()は依存(migrate)を引数で受け取る設計のため、実際の
// migrateCorrectionCredentials(node:sqliteへ接続する../config/db経由)は不要。
// スクリプトのモジュールを読み込むだけでDB接続チェーンが評価されるのを避ける。
vi.mock("../src/corrections/repository", () => ({
  migrateCorrectionCredentials: vi.fn(),
}));

const { runMigration } = await import("../src/scripts/migrateCorrectionCredentials");

// T008: このCLIの運用上重要な契約(未解決が1件でもあれば非ゼロ終了する・jobIdを
// 一切出力しない)を直接検証する(Codexレビュー指摘、2026-09-04)。

function baseSummary(overrides: Partial<CorrectionCredentialMigrationSummary> = {}): CorrectionCredentialMigrationSummary {
  return {
    revokedSessions: 0,
    migratedCorrections: 0,
    migratedSourceReferenceStats: 0,
    migratedRulingJobResultJson: 0,
    unresolvedRulingJobResultJsonMarkerCount: 0,
    invalidRulingJobResultJsonCount: 0,
    possibleKnownIdCollisionRulingJobResultJsonCount: 0,
    ...overrides,
  };
}

describe("runMigration", () => {
  it("未解決0件・解析失敗0件なら終了コード0を返し、3種類の監査件数が0件であることをlogへ明示する(Codexレビュー指摘、2026-09-04、round 18: 正常終了時に件数が出力されないと、Web Shellの操作者が「0件だったこと」と「確認を見落としたこと」を区別できない)", () => {
    const log = vi.fn();
    const logError = vi.fn();

    const exitCode = runMigration(() => baseSummary(), log, logError);

    expect(exitCode).toBe(0);
    expect(logError).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("ruling_job.result_json監査件数: 未解決マーカー=0件、JSON解析失敗=0件、既知ID衝突(要確認)=0件"),
    );
  });

  it("未解決マーカーが1件でもあれば終了コード1を返し、件数のみを報告する(jobIdは一切出力しない)", () => {
    const log = vi.fn();
    const logError = vi.fn();

    const exitCode = runMigration(() => baseSummary({ unresolvedRulingJobResultJsonMarkerCount: 1 }), log, logError);

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledTimes(1);
    const message = logError.mock.calls[0][0] as string;
    // メッセージは固定テンプレート+件数のみで構成されることを完全一致で検証する
    // (Codexレビュー指摘、2026-09-04、round 16: `/job-[\w-]+/`のような形式依存の
    // 否定マッチだと、"job-"で始まらないUUID等の実際のjobId形式が将来出力に
    // 混入しても検出できない。固定テンプレートと完全一致することを確認すれば、
    // テンプレートに変数が新たに紛れ込む変更自体を検出できる)。
    expect(message).toBe(
      "未解決: ruling_job.result_jsonに\"ジャッジID\"相当の文字列が残存している行が1件、" +
        "JSONとして解析できなかった行が0件あります。" +
        "本番DBを直接クエリして個別に確認してください(jobIdはこのスクリプトの出力には含めません)。",
    );
  });

  it("JSON解析失敗が1件でもあれば終了コード1を返す(表記揺れとは別カウントで報告)", () => {
    const log = vi.fn();
    const logError = vi.fn();

    const exitCode = runMigration(() => baseSummary({ invalidRulingJobResultJsonCount: 1 }), log, logError);

    expect(exitCode).toBe(1);
    expect(logError.mock.calls[0][0]).toContain("解析できなかった行が1件");
  });

  it("既知ID値との一致(possibleKnownIdCollision)は誤検知の可能性があっても無条件の成功扱いにはせず、要確認として終了コード1を返す(過去のインシデントで実際に4桁数値IDが漏洩した実績があるため、Codexレビュー指摘)", () => {
    const log = vi.fn();
    const logError = vi.fn();

    const exitCode = runMigration(
      () => baseSummary({ possibleKnownIdCollisionRulingJobResultJsonCount: 1 }),
      log,
      logError,
    );

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledTimes(1);
    const message = logError.mock.calls[0][0] as string;
    // 固定テンプレート+件数のみで構成されることを完全一致で検証する(上記と同様、
    // Codexレビュー指摘、2026-09-04、round 16)。
    expect(message).toBe(
      "要確認: 既知のジャッジID値と一致する可能性のある行が1件あります。" +
        "数字の偶然の一致(ルール番号・URL等)の可能性もありますが、確定した誤検知ではないため自動では成功扱いにしません。" +
        "本番DBを直接クエリして手動で内容を確認し、無関係と判断できた場合のみ完了としてください(jobIdはこのスクリプトの出力には含めません)。",
    );
  });

  it("未解決マーカー・解析失敗・既知ID衝突が同時に存在する場合、いずれの件数もCLI出力から欠落しない(Codexレビュー指摘: 最初のif内でreturnしていたため既知ID衝突の件数が出力されなかった不備)", () => {
    const log = vi.fn();
    const logError = vi.fn();

    const exitCode = runMigration(
      () =>
        baseSummary({
          unresolvedRulingJobResultJsonMarkerCount: 1,
          invalidRulingJobResultJsonCount: 1,
          possibleKnownIdCollisionRulingJobResultJsonCount: 1,
        }),
      log,
      logError,
    );

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("ruling_job.result_json監査件数: 未解決マーカー=1件、JSON解析失敗=1件、既知ID衝突(要確認)=1件"),
    );
    const messages = logError.mock.calls.map((call) => call[0] as string);
    expect(messages.some((m) => m.includes("未解決") && m.includes("1件"))).toBe(true);
    // 解析失敗の件数も(表記揺れ残存と同じメッセージ内で)出力されることを確認する
    // (Codexレビュー指摘、2026-09-04: このメッセージ文言が将来削除されても
    // テストが気づけるようにする)。
    expect(messages.some((m) => m.includes("解析できなかった行が1件"))).toBe(true);
    expect(messages.some((m) => m.includes("要確認"))).toBe(true);
  });

  it("migrate自体が例外を投げた場合も終了コード1を返し、例外メッセージ本文は出力しない(将来jobId等の機微情報を含む可能性があるため、Codexレビュー指摘)", () => {
    const log = vi.fn();
    const logError = vi.fn();
    const sensitiveMessage = "failed for job-super-secret-id-12345";

    const exitCode = runMigration(
      () => {
        throw new Error(sensitiveMessage);
      },
      log,
      logError,
    );

    expect(exitCode).toBe(1);
    expect(logError).toHaveBeenCalled();
    const message = logError.mock.calls[0][0] as string;
    expect(message).not.toContain(sensitiveMessage);
    expect(message).not.toContain("job-super-secret-id-12345");
  });

  it("正常時は各件数をlogへ出力する", () => {
    const log = vi.fn();
    const logError = vi.fn();

    runMigration(
      () =>
        baseSummary({
          revokedSessions: 2,
          migratedCorrections: 3,
          migratedSourceReferenceStats: 1,
          migratedRulingJobResultJson: 4,
        }),
      log,
      logError,
    );

    expect(log).toHaveBeenCalledWith(expect.stringContaining("2"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("4"));
  });
});
