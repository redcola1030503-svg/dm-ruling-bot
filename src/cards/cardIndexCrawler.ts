import { fetchCardListPage, getOfficialCard } from "./cardSearch";
import {
  getCardIndexCount,
  getCardIndexUpdatedAt,
  getLastKnownTotalCount,
  upsertCardIndexEntryWithAltNames,
} from "./cardIndexRepository";
import type { CardSearchHit } from "./types";
import { logger } from "../utils/logger";

// card_indexの1エントリをこの期間内に更新済みなら再取得をスキップする
// (差分更新。総合ルールembedding生成と同じ考え方)。
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30日
// 空keyword検索でのページネーション終了判定・安全弁。
const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
const MAX_PAGES = 2000;
const PROGRESS_LOG_INTERVAL = 100;
// 収集件数が既存登録数からこの割合を下回った場合、公式サイト側の応答異常
// (エラーページ・HTML変更・一時的な再送等)を疑い、クロールを失敗として
// 扱う(Codexレビュー指摘: 不完全な一覧を正常完了扱いしていた)。
// 前回チェック時点の記録値・DB行数を基準にする場合(やや古い/粗い基準)は
// 緩めの閾値、この実行の直前に取得した最新値(expectedTotal)が使える場合は
// 厳格な閾値を適用する(Codexレビュー指摘: 直前の実測値があるのに緩い閾値
// のままでは、1ページ分程度の欠落を見逃しうる)。
const MIN_ACCEPTABLE_HIT_RATIO = 0.5;
const MIN_ACCEPTABLE_HIT_RATIO_WITH_EXPECTED_TOTAL = 0.99;

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
type CollectAllCardHitsResult = {
  hits: CardSearchHit[];
  // trueの場合、自然な終端(空ページ連続 or 新規IDゼロ)に達する前に
  // ページ数上限で打ち切られている(終端検出の失敗や想定外の件数増加を疑うべき)。
  exhaustedMaxPages: boolean;
};

async function collectAllCardHits(): Promise<CollectAllCardHitsResult> {
  const seen = new Map<string, CardSearchHit>();
  let pagenum = 1;
  // 空ページ、または新規IDがゼロのページ(同一ページの一時的な再送等)の
  // いずれであっても、連続してMAX_CONSECUTIVE_EMPTY_PAGES回「進展が無い」
  // ことを確認してから終端とみなす。1回の非進展だけで即座に終端扱いすると、
  // 一時的な同一ページ再送を本当の終端と誤認しうる(Codexレビュー指摘:
  // 従来は新規IDゼロを1回検出した時点で即break していた)。
  let consecutiveNonProgressPages = 0;
  // 進展が無かったページ番号は、非進展として数える前にもう一度だけ同じ
  // 番号を取得し直す。単発の一時的な応答異常(該当ページだけがエラー
  // ページ・前ページの再送だった場合)でそのページ分のカードが永久に
  // 欠落するのを防ぐ(Codexレビュー指摘: 従来はpagenumを進めるだけで、
  // 該当ページ自体を再試行していなかった)。
  let retriedCurrentPage = false;

  while (pagenum <= MAX_PAGES && consecutiveNonProgressPages < MAX_CONSECUTIVE_EMPTY_PAGES) {
    const hits = await fetchCardListPage("", pagenum);

    let newHitsInPage = 0;
    for (const hit of hits) {
      if (!seen.has(hit.id)) {
        seen.set(hit.id, hit);
        newHitsInPage += 1;
      }
    }
    console.log(`page ${pagenum}: ${hits.length}件取得 (累計 ${seen.size}件)`);

    if (newHitsInPage > 0) {
      consecutiveNonProgressPages = 0;
      retriedCurrentPage = false;
      pagenum += 1;
      continue;
    }

    if (!retriedCurrentPage) {
      retriedCurrentPage = true;
      continue;
    }
    retriedCurrentPage = false;
    consecutiveNonProgressPages += 1;
    pagenum += 1;
  }

  return { hits: Array.from(seen.values()), exhaustedMaxPages: pagenum > MAX_PAGES };
}

/**
 * card_indexの全件クロール本体。CLIスクリプト(buildCardIndex.ts)と、
 * 管理者APIからのバックグラウンドジョブ(cardIndexBuildJob.ts)の両方から
 * 呼ばれる共通ロジック。onProgressはジョブの状態管理(ポーリングAPI用)に
 * 使う。
 */
export async function runCardIndexBuild(
  onProgress?: (progress: CardIndexBuildProgress) => void,
  options?: { forceRefresh?: boolean; expectedTotal?: number | null },
): Promise<CardIndexBuildSummary> {
  console.log("カード一覧を取得中(空keywordで全件検索)...");
  const { hits: allHits, exhaustedMaxPages } = await collectAllCardHits();
  console.log(`カードID収集完了: ${allHits.length}件`);

  if (exhaustedMaxPages) {
    throw new Error(
      `ページネーション上限(${MAX_PAGES}ページ)に達したため打ち切りました(終端検出の失敗、または想定外の件数増加の可能性)`,
    );
  }
  if (allHits.length === 0) {
    throw new Error("カード一覧の取得件数が0件でした(公式サイトの応答異常の可能性)");
  }
  // 比較基準の優先順位: (1)呼び出し元がこの実行の直前に公式サイトから取得した
  // 総数(expectedTotal、最も新鮮で正確)、(2)前回チェック時点で確認できた総数
  // (getLastKnownTotalCount)、(3)card_indexのDB行数(getCardIndexCount、一覧
  // から外れた特殊カード等の残存行を含み実際の掲載数より多いため最終フォール
  // バックに留める、Codexレビュー指摘)。
  const hasExpectedTotal = options?.expectedTotal != null;
  const referenceTotal = options?.expectedTotal ?? getLastKnownTotalCount() ?? getCardIndexCount();
  const hitRatioThreshold = hasExpectedTotal ? MIN_ACCEPTABLE_HIT_RATIO_WITH_EXPECTED_TOTAL : MIN_ACCEPTABLE_HIT_RATIO;
  if (referenceTotal > 0 && allHits.length < referenceTotal * hitRatioThreshold) {
    throw new Error(
      `カード一覧の取得件数(${allHits.length}件)が既知の総数(${referenceTotal}件)から大幅に減少しています(公式サイトの応答異常の可能性)`,
    );
  }

  const forceRefresh = options?.forceRefresh ?? false;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allHits.length; i++) {
    const hit = allHits[i]!;
    const existingUpdatedAt = getCardIndexUpdatedAt(hit.id);
    if (!forceRefresh && existingUpdatedAt !== null && Date.now() - existingUpdatedAt < STALE_THRESHOLD_MS) {
      skipped += 1;
    } else {
      try {
        const card = await getOfficialCard(hit, { force: forceRefresh });
        if (card) {
          upsertCardIndexEntryWithAltNames(card.id, card.name, card.url, card.alternateNames);
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
