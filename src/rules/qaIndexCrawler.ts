import axios from "axios";
import { fetchQaListPage, fetchQaOldListPage } from "./qaSearch";
import { parseQaDetailPage } from "./qaParser";
import { fetchHtml } from "../utils/httpClient";
import { getQaIndexCount, getQaIndexUpdatedAt, upsertQaIndexEntry } from "./qaIndexRepository";
import type { QaListItem } from "./types";
import { logger } from "../utils/logger";

// qa_indexの1エントリをこの期間内に更新済みなら再取得をスキップする。公式Q&Aは
// 一度公開された質問・回答が事後修正されることは稀なため、card_index(30日)より
// 長めに取る(差分クロールの実行コストを抑える)。
const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90日
// 空keyword検索でのページネーション終了判定・安全弁。
const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
const MAX_PAGES = 2000;
const PROGRESS_LOG_INTERVAL = 100;

export type QaIndexBuildProgress = {
  processed: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type QaIndexBuildSummary = QaIndexBuildProgress & { totalCount: number };

/**
 * 1つの一覧(pageFetcher)をpagenumを進めながらクロールし、既知のseenマップへ
 * 新規{id, url}を追加していく(cardIndexCrawler.tsのcollectAllCardHitsと同じ設計)。
 */
async function collectAllQaHitsFrom(
  label: string,
  pageFetcher: (pagenum: number) => Promise<QaListItem[]>,
  seen: Map<string, QaListItem>,
): Promise<void> {
  let pagenum = 1;
  let consecutiveEmptyPages = 0;

  while (pagenum <= MAX_PAGES && consecutiveEmptyPages < MAX_CONSECUTIVE_EMPTY_PAGES) {
    let items: QaListItem[];
    try {
      items = await pageFetcher(pagenum);
    } catch (error) {
      // ページネーション終端でのAxios 404は「それ以上結果がない」だけの正常系。
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        items = [];
      } else {
        // タイムアウト等の一時的なネットワークエラーで全体を止めない。このページの
        // 取得だけ諦めて次ページに進む(差分再実行のため、次回の実行で拾い直せる)。
        logger.warn("qa_list_page_fetch_failed", {
          label,
          pagenum,
          error: error instanceof Error ? error.message : String(error),
        });
        pagenum += 1;
        continue;
      }
    }

    if (items.length === 0) {
      consecutiveEmptyPages += 1;
      pagenum += 1;
      continue;
    }

    let newItemsInPage = 0;
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.set(item.id, item);
        newItemsInPage += 1;
      }
    }
    console.log(`[${label}] page ${pagenum}: ${items.length}件取得 (累計 ${seen.size}件)`);

    if (newItemsInPage === 0) {
      // 全て既知のIDだった = 同じページが繰り返されている(終端到達)とみなす
      break;
    }
    consecutiveEmptyPages = 0;
    pagenum += 1;
  }
}

/**
 * 現行の/rule/qa/検索一覧と、そこでは辿れなくなった過去のQ&Aアーカイブ
 * (/rule/qa_old/)の両方をクロールし、全Q&Aの{id, url}一覧を収集する。
 * 同じQ&Aが両方に出てくることがあるが、idベースのMapで自動的に重複排除される。
 */
async function collectAllQaHits(): Promise<QaListItem[]> {
  const seen = new Map<string, QaListItem>();
  await collectAllQaHitsFrom("qa", (pagenum) => fetchQaListPage("", pagenum), seen);
  await collectAllQaHitsFrom("qa_old", (pagenum) => fetchQaOldListPage(pagenum), seen);
  return Array.from(seen.values());
}

/**
 * qa_index(意味検索用Q&A全件コーパス)の全件クロール本体。CLIスクリプト
 * (buildQaIndex.ts)から呼ばれる。qa_cache(既存の短命キャッシュ)には触れない。
 */
export async function runQaIndexBuild(
  onProgress?: (progress: QaIndexBuildProgress) => void,
): Promise<QaIndexBuildSummary> {
  console.log("Q&A一覧を取得中(空keywordで全件検索)...");
  const allItems = await collectAllQaHits();
  console.log(`Q&A ID収集完了: ${allItems.length}件`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i]!;
    try {
      const existingUpdatedAt = getQaIndexUpdatedAt(item.id);
      if (existingUpdatedAt !== null && Date.now() - existingUpdatedAt < STALE_THRESHOLD_MS) {
        skipped += 1;
      } else {
        const html = await fetchHtml(item.url);
        const detail = parseQaDetailPage(html, item.id, item.url);
        if (detail) {
          upsertQaIndexEntry(detail);
          updated += 1;
        } else {
          failed += 1;
        }
      }
    } catch (error) {
      failed += 1;
      logger.error("qa_index_entry_failed", {
        id: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const processed = i + 1;
    if (processed % PROGRESS_LOG_INTERVAL === 0 || processed === allItems.length) {
      console.log(`進捗: ${processed}/${allItems.length}件 (更新${updated} / スキップ${skipped} / 失敗${failed})`);
      onProgress?.({ processed, total: allItems.length, updated, skipped, failed });
    }
  }

  const totalCount = getQaIndexCount();
  console.log(`完了。更新: ${updated}, スキップ: ${skipped}, 失敗: ${failed}, qa_index総登録数: ${totalCount}`);
  return { processed: allItems.length, total: allItems.length, updated, skipped, failed, totalCount };
}
