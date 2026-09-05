import type { findUnresolvedLegacyCorrectionTitleJobIds as FindUnresolvedLegacyCorrectionTitleJobIdsType } from "../ruling/rulingJobRepository";

// T008: migrateCorrectionCredentials.js(通常のマイグレーション)が意図的に自動
// 置換しない「旧titleが説明文などへ埋め込まれたケース」の対象jobIdを特定するための、
// 読み取り専用の診断スクリプト。実際の修復(result_jsonの安全な固定文言への
// 置き換え)はこのスクリプトでは行わない。
//
// 経緯(2026-09-05): 当初はこの特定〜修復までを自動化する専用スクリプト(部分置換
// →フィールド値全体の非表示化→検証トークンによるTOCTOU対策、と設計を重ねた)を
// 構築していたが、対象は本番に実在する「たった1行の過去データ」であり、そのため
// に積み上げた安全性のコスト(境界推測の排除・暗号学的検証トークン・多層のテスト)
// は見合わないとユーザー判断により撤回した。診断(jobId特定)と修復(手動UPDATE)を
// 分離し、修復はRender Web Shellから運用者が直接実行する運用にする。
//
// jobIdの取り扱いについて(Codexレビュー指摘、2026-09-05、round22): jobIdは
// `randomUUID()`で生成される推測困難な値だが、認証不要`GET /api/ruling/jobs/:jobId`
// がジャッジIDを含む対象結果へのアクセスキーとして機能するため「非機微情報」
// ではない。この出力はRender Web Shellの画面上に運用者本人が一時的に表示する
// だけの用途に限り、タスク文書・レビュープロンプト・チャット等の恒久的に残る
// 場所へは書き写さないこと(このタスクで過去に発生した2回の転記漏洩と同じ経路
// を避けるため)。
//
// 注意事項(Codexレビュー指摘、2026-09-05、round23): 以下の手順は本番DBへ直接
// SQLを入力する手動操作であり、(1)Render Web Shellで過去に日本語(CJK)入力が
// 欠落した実績があること、(2)UPDATE時の`LIKE`条件は診断条件(NFKC正規化・
// 表記揺れ対応込み)と完全には一致しないこと、という2点のリスクが残る。この
// リスクを自動化コードで排除する案(hexリテラル入力、SQLiteのjson_tree等による
// 厳密な条件一致)も検討したが、round18〜21で一度撤回した「自動化の複雑化」と
// 同じ方向に戻ってしまうため、ユーザー判断によりコード化せず、手順2でSELECTの
// 結果を必ず目視確認してからUPDATEを実行することでリスクを緩和する運用とする。
//
// 運用手順:
//   1. node dist/scripts/findUnresolvedLegacyCorrectionTitleJobIds.js を実行し、
//      対象jobIdの一覧を確認する(件数は事前調査で把握している値〈通常1件〉と
//      一致することを確認する)。
//   2. 対象jobIdごとに、Render Web Shellから以下の手順で1つのトランザクション
//      として実行する。**SELECTの結果セット(id・result_jsonの内容)を必ず目視
//      確認し、意図した行であることを確認してからUPDATEへ進むこと**:
//        BEGIN IMMEDIATE;
//        SELECT id, result_json FROM ruling_job WHERE id = '<対象jobId>' AND result_json LIKE '%過去の訂正事例%';
//        -- 上記が1行返し、result_jsonの内容が想定通り(旧titleの埋め込みケース)
//        -- であることを目視確認する。0行、または内容が想定と異なる場合は
//        -- ROLLBACKし、診断結果が古くなっていないか本番DBを再調査する。
//        UPDATE ruling_job
//        SET result_json = '{"conclusion":"この回答はセキュリティ上の理由により非表示になりました","explanation":"この回答はセキュリティ上の理由により非表示になりました","steps":[],"confidence":"low","cards":[],"sources":[]}'
//        WHERE id = '<対象jobId>' AND result_json LIKE '%過去の訂正事例%';
//        SELECT changes();
//        -- 上記が1であることを確認してからCOMMITする(1以外ならROLLBACKする)。
//        COMMIT;
//   3. node dist/scripts/migrateCorrectionCredentials.js を再実行し、
//      unresolvedRulingJobResultJsonMarkerCount・invalidRulingJobResultJsonCount・
//      possibleKnownIdCollisionRulingJobResultJsonCountの3種類すべてが0に
//      なったことを確認する(完了条件は.ai/tasks/T008-correction-leak-quick-fix.md
//      のStatus・Out of Scope参照)。
export function runFindUnresolvedJobIds(find: () => string[], log: (message: string) => void, logError: (message: string) => void): number {
  try {
    const jobIds = find();
    log(`対象行数: ${jobIds.length}件`);
    for (const jobId of jobIds) {
      log(`jobId: ${jobId}`);
    }
    return 0;
  } catch {
    // エラーメッセージ本文は出力しない(migrateCorrectionCredentials.tsと同じ理由:
    // 下位層の例外が将来jobIdや値を含むようになった場合でも、この出力〈Render Web
    // Shellの画面に直接表示される〉へ漏れないようにする)。
    logError("診断処理中に例外が発生しました。原因の詳細はこのスクリプトの出力には含めません。本番DBの状態を直接確認してください。");
    return 1;
  }
}

if (require.main === module) {
  try {
    // 型のみ静的importし、実装はここでrequireする(Codexレビュー指摘、2026-09-05、
    // round22: 静的importのままだと、依存モジュールの評価〈DB接続初期化等〉が
    // 例外を投げた場合にrunFindUnresolvedJobIds()のtry/catchへ届かず、Node.jsが
    // 例外メッセージ・スタックをそのまま出力してしまう)。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { findUnresolvedLegacyCorrectionTitleJobIds } = require("../ruling/rulingJobRepository") as {
      findUnresolvedLegacyCorrectionTitleJobIds: typeof FindUnresolvedLegacyCorrectionTitleJobIdsType;
    };
    process.exitCode = runFindUnresolvedJobIds(findUnresolvedLegacyCorrectionTitleJobIds, console.log, console.error);
  } catch {
    console.error("診断処理中に例外が発生しました。原因の詳細はこのスクリプトの出力には含めません。本番DBの状態を直接確認してください。");
    process.exitCode = 1;
  }
}
