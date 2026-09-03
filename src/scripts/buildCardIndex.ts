import { runCardIndexBuild } from "../cards/cardIndexCrawler";

// --force: card_cache/card_indexの既存キャッシュ(TTL内)を無視し、公式サイトから
// 全件を再取得する。alternateNames(サイキック/ドラグハート等の裏面名)対応の
// ようにパース結果のスキーマ自体を変更した場合、通常実行(差分更新)では
// 既にキャッシュ済みのカードへ反映されないため、リリース直後に1回だけ使う想定。
const forceRefresh = process.argv.includes("--force");

runCardIndexBuild(undefined, { forceRefresh })
  .then((summary) => {
    // --force実行(スキーマ変更直後の全件反映が目的)で一部のカードが失敗すると、
    // そのカードは既存card_indexのupdated_atが更新されないままになるとは限らない
    // (取得自体に失敗しupsertされない)ため通常の差分更新でも再取得されず、
    // alternateNames等が反映されないまま気づかれにくい。非ゼロ終了にして
    // 呼び出し元(Renderシェル操作者)に再実行の要否を明示する。
    if (forceRefresh && summary.failed > 0) {
      console.error(`強制再構築で${summary.failed}件のカード取得が失敗しました。再実行を検討してください。`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
