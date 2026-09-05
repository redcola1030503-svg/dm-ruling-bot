import { migrateCorrectionCredentials, type CorrectionCredentialMigrationSummary } from "../corrections/repository";

// T008: 1回限りの本番マイグレーション。corrected_by列に残る生のセッショントークンを
// judgeIdへ置き換え、該当セッションを失効させ、source_reference_statの旧タイトルを
// 揃える。Render Web Shellから `node dist/scripts/migrateCorrectionCredentials.js` で実行する。
//
// ロジックをrunMigration()へ分離しているのは、非ゼロ終了コード・出力内容(特に
// jobIdを一切含めないこと)を直接テストするため(Codexレビュー指摘、2026-09-04)。
export function runMigration(
  migrate: () => CorrectionCredentialMigrationSummary,
  log: (message: string) => void,
  logError: (message: string) => void,
): number {
  try {
    const summary = migrate();
    log(`失効させたセッション数: ${summary.revokedSessions}`);
    log(`corrected_byを移行した訂正数: ${summary.migratedCorrections}`);
    log(`source_reference_statのタイトルを移行した件数: ${summary.migratedSourceReferenceStats}`);
    log(`ruling_job.result_jsonのタイトルを移行した件数: ${summary.migratedRulingJobResultJson}`);

    const {
      unresolvedRulingJobResultJsonMarkerCount,
      invalidRulingJobResultJsonCount,
      possibleKnownIdCollisionRulingJobResultJsonCount,
    } = summary;

    // 3種類の監査件数は、非ゼロの場合だけでなく常にlogへ出力する(Codexレビュー
    // 指摘、2026-09-04、round 18): 従来は非ゼロの場合にlogErrorでのみ表示していた
    // ため、正常終了(すべて0件)の場合はこれらの件数が出力に一切現れず、
    // Render Web Shellの操作者が「0件だったこと」と「確認自体を見落としたこと」を
    // 出力だけからは区別できなかった。完了条件はこの3種類すべてが0件であることの
    // ため、成否にかかわらず必ず件数を出力する。
    log(
      `ruling_job.result_json監査件数: 未解決マーカー=${unresolvedRulingJobResultJsonMarkerCount}件、` +
        `JSON解析失敗=${invalidRulingJobResultJsonCount}件、既知ID衝突(要確認)=${possibleKnownIdCollisionRulingJobResultJsonCount}件`,
    );

    // 3種類の件数は独立に報告する(Codexレビュー指摘、2026-09-04: 未解決マーカー・
    // 解析失敗のいずれかがあると即座にreturnしていたため、既知ID衝突が同時に
    // 存在してもその件数がCLI出力から欠落していた)。いずれか1件でもあれば
    // 非ゼロ終了にする。既知ID値そのものとの一致(possibleKnownIdCollision)は
    // 誤検知が多い(短い数値IDがルール番号・年・URL等に偶然含まれうる)が、
    // 過去のインシデントで実際に漏洩したIDが4桁数値だった実績があるため、
    // 「誤検知の可能性が高い」ことを理由に無条件で成功(終了コード0)扱いには
    // しない。確定した表記揺れ残存・解析失敗とは異なり「要手動確認」という
    // 性質のため、その旨を明示した上で非ゼロ終了にする。
    let hasProblem = false;

    if (unresolvedRulingJobResultJsonMarkerCount > 0 || invalidRulingJobResultJsonCount > 0) {
      // 既知の旧title文字列(buildLegacyTitles)が対応していない未知の表記揺れ、または解析できなかった行が
      // 残っている可能性がある。jobIdは出力しない(Codexレビュー指摘、2026-09-04):
      // 未解決行はまだジャッジIDが残っている(または内容不明の)行を指すため、jobId
      // を開示すると認証不要のGET /api/ruling/jobs/:jobIdから直接その内容を取得
      // できてしまう。個別調査は本番DBを直接クエリして行う。
      logError(
        `未解決: ruling_job.result_jsonに"ジャッジID"相当の文字列が残存している行が${unresolvedRulingJobResultJsonMarkerCount}件、` +
          `JSONとして解析できなかった行が${invalidRulingJobResultJsonCount}件あります。` +
          `本番DBを直接クエリして個別に確認してください(jobIdはこのスクリプトの出力には含めません)。`,
      );
      hasProblem = true;
    }
    if (possibleKnownIdCollisionRulingJobResultJsonCount > 0) {
      logError(
        `要確認: 既知のジャッジID値と一致する可能性のある行が${possibleKnownIdCollisionRulingJobResultJsonCount}件あります。` +
          `数字の偶然の一致(ルール番号・URL等)の可能性もありますが、確定した誤検知ではないため自動では成功扱いにしません。` +
          `本番DBを直接クエリして手動で内容を確認し、無関係と判断できた場合のみ完了としてください(jobIdはこのスクリプトの出力には含めません)。`,
      );
      hasProblem = true;
    }
    return hasProblem ? 1 : 0;
  } catch (error) {
    // エラーメッセージ本文は出力しない(Codexレビュー指摘、2026-09-04): 下位層の
    // 例外が将来jobIdやSQL断片等の機微情報を含むようになった場合でも、この
    // スクリプトの出力(Render Web Shellの画面に直接表示される)へ漏れないようにする。
    const errorKind = error instanceof Error ? error.constructor.name : typeof error;
    logError(
      `移行処理中に例外が発生しました(${errorKind})。原因の詳細はこのスクリプトの出力には含めません。本番DBの状態を直接確認してください。`,
    );
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runMigration(migrateCorrectionCredentials, console.log, console.error);
}
