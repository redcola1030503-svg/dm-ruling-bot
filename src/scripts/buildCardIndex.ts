import { fetchCardListPage, getOfficialCard } from "../cards/cardSearch";
import {
  getCardIndexCount,
  getCardIndexUpdatedAt,
  upsertCardIndexEntry,
} from "../cards/cardIndexRepository";
import type { CardSearchHit } from "../cards/types";
import { logger } from "../utils/logger";

// card_indexの1エントリをこの期間内に更新済みなら再取得をスキップする
// (差分更新。総合ルールembedding生成と同じ考え方)。
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30日
// 空keyword検索でのページネーション終了判定・安全弁。
const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
const MAX_PAGES = 2000;
const PROGRESS_LOG_INTERVAL = 100;

/**
 * keywordを空にした全カード検索をpagenumを進めながらクロールし、
 * 全カードの{id, url}を収集する。新しいヒットが得られなくなった時点で
 * ページネーションの終端とみなす(1ページあたりの件数は公式サイト側の
 * 仕様に依存するため固定せず、動的に判定する)。
 */
async function collectAllCardHits(): Promise<CardSearchHit[]> {
  const seen = new Map<string, CardSearchHit>();
  let pagenum = 1;
  let consecutiveEmptyPages = 0;

  while (pagenum <= MAX_PAGES && consecutiveEmptyPages < MAX_CONSECUTIVE_EMPTY_PAGES) {
    const hits = await fetchCardListPage("", pagenum);
    if (hits.length === 0) {
      consecutiveEmptyPages += 1;
      pagenum += 1;
      continue;
    }

    let newHitsInPage = 0;
    for (const hit of hits) {
      if (!seen.has(hit.id)) {
        seen.set(hit.id, hit);
        newHitsInPage += 1;
      }
    }
    console.log(`page ${pagenum}: ${hits.length}件取得 (累計 ${seen.size}件)`);

    if (newHitsInPage === 0) {
      // 全て既知のIDだった = 同じページが繰り返されている(終端到達)とみなす
      break;
    }
    consecutiveEmptyPages = 0;
    pagenum += 1;
  }

  return Array.from(seen.values());
}

async function main(): Promise<void> {
  console.log("カード一覧を取得中(空keywordで全件検索)...");
  const allHits = await collectAllCardHits();
  console.log(`カードID収集完了: ${allHits.length}件`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allHits.length; i++) {
    const hit = allHits[i]!;
    const existingUpdatedAt = getCardIndexUpdatedAt(hit.id);
    if (existingUpdatedAt !== null && Date.now() - existingUpdatedAt < STALE_THRESHOLD_MS) {
      skipped += 1;
    } else {
      try {
        const card = await getOfficialCard(hit);
        if (card) {
          upsertCardIndexEntry(card.id, card.name, card.url);
          updated += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        logger.error("card_index_entry_failed", {
          id: hit.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if ((i + 1) % PROGRESS_LOG_INTERVAL === 0) {
      console.log(`進捗: ${i + 1}/${allHits.length}件 (更新${updated} / スキップ${skipped} / 失敗${failed})`);
    }
  }

  console.log(
    `完了。更新: ${updated}, スキップ: ${skipped}, 失敗: ${failed}, card_index総登録数: ${getCardIndexCount()}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
