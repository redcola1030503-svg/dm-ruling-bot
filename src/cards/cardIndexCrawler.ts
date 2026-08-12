import { fetchCardListPage, getOfficialCard } from "./cardSearch";
import { getCardIndexCount, getCardIndexUpdatedAt, upsertCardIndexEntry } from "./cardIndexRepository";
import type { CardSearchHit } from "./types";
import { logger } from "../utils/logger";

// card_indexの1エントリをこの期間内に更新済みなら再取得をスキップする
// (差分更新。総合ルールembedding生成と同じ考え方)。
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30日
// 空keyword検索でのページネーション終了判定・安全弁。
const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
const MAX_PAGES = 2000;
const PROGRESS_LOG_INTERVAL = 100;

export type CardIndexBuildProgress = {
  processed: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type CardIndexBuildSummary = CardIndexBuildProgress & { totalCount: number };

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

/**
 * card_indexの全件クロール本体。CLIスクリプト(buildCardIndex.ts)と、
 * 管理者APIからのバックグラウンドジョブ(cardIndexBuildJob.ts)の両方から
 * 呼ばれる共通ロジック。onProgressはジョブの状態管理(ポーリングAPI用)に
 * 使う。
 */
export async function runCardIndexBuild(
  onProgress?: (progress: CardIndexBuildProgress) => void,
): Promise<CardIndexBuildSummary> {
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

    const processed = i + 1;
    if (processed % PROGRESS_LOG_INTERVAL === 0 || processed === allHits.length) {
      console.log(`進捗: ${processed}/${allHits.length}件 (更新${updated} / スキップ${skipped} / 失敗${failed})`);
      onProgress?.({ processed, total: allHits.length, updated, skipped, failed });
    }
  }

  const totalCount = getCardIndexCount();
  console.log(`完了。更新: ${updated}, スキップ: ${skipped}, 失敗: ${failed}, card_index総登録数: ${totalCount}`);
  return { processed: allHits.length, total: allHits.length, updated, skipped, failed, totalCount };
}
