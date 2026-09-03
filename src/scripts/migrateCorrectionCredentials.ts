import { migrateCorrectionCredentials } from "../corrections/repository";

// T008: 1回限りの本番マイグレーション。corrected_by列に残る生のセッショントークンを
// judgeIdへ置き換え、該当セッションを失効させ、source_reference_statの旧タイトルを
// 揃える。Render Web Shellから `node dist/scripts/migrateCorrectionCredentials.js` で実行する。
try {
  const summary = migrateCorrectionCredentials();
  console.log(`失効させたセッション数: ${summary.revokedSessions}`);
  console.log(`corrected_byを移行した訂正数: ${summary.migratedCorrections}`);
  console.log(`source_reference_statのタイトルを移行した件数: ${summary.migratedSourceReferenceStats}`);
  console.log(`ruling_job.result_jsonのタイトルを移行した件数: ${summary.migratedRulingJobResultJson}`);
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
