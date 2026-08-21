import { DMWIKI_KEYWORD_ABILITY_NAMES } from "./keywordAbilityNames";
import { parseKeywordAbilityPage } from "./dmwikiParser";
import { fetchHtml } from "../utils/httpClient";
import {
  getKeywordAbilityCount,
  getKeywordAbilityUpdatedAt,
  upsertKeywordAbility,
} from "./keywordAbilityRepository";
import { logger } from "../utils/logger";

const DMWIKI_ORIGIN = "https://dmwiki.net";
// 能力の定義文はゲームルールの変更がない限りほぼ不変のため、qa_index(90日)より
// 長めの間隔で差分更新する。
const STALE_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;
const PROGRESS_LOG_INTERVAL = 50;

export type KeywordAbilityBuildProgress = {
  processed: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type KeywordAbilityBuildSummary = KeywordAbilityBuildProgress & { totalCount: number };

/**
 * dmwiki.net(https://dmwiki.net/{URLエンコードした能力名})から各キーワード能力の
 * 説明文をクロールし、keyword_abilityテーブルへ保存する。qaIndexCrawler.tsと
 * 同じ設計(差分更新、個別失敗を許容して継続)。
 */
export async function runKeywordAbilityBuild(
  onProgress?: (progress: KeywordAbilityBuildProgress) => void,
): Promise<KeywordAbilityBuildSummary> {
  const names = DMWIKI_KEYWORD_ABILITY_NAMES;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    try {
      const existingUpdatedAt = getKeywordAbilityUpdatedAt(name);
      if (existingUpdatedAt !== null && Date.now() - existingUpdatedAt < STALE_THRESHOLD_MS) {
        skipped += 1;
      } else {
        const url = `${DMWIKI_ORIGIN}/${encodeURIComponent(name)}`;
        const html = await fetchHtml(url);
        const description = parseKeywordAbilityPage(html);
        if (description) {
          upsertKeywordAbility(name, url, description);
          updated += 1;
        } else {
          failed += 1;
        }
      }
    } catch (error) {
      failed += 1;
      logger.error("keyword_ability_entry_failed", {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const processed = i + 1;
    if (processed % PROGRESS_LOG_INTERVAL === 0 || processed === names.length) {
      console.log(`進捗: ${processed}/${names.length}件 (更新${updated} / スキップ${skipped} / 失敗${failed})`);
      onProgress?.({ processed, total: names.length, updated, skipped, failed });
    }
  }

  const totalCount = getKeywordAbilityCount();
  console.log(`完了。更新: ${updated}, スキップ: ${skipped}, 失敗: ${failed}, keyword_ability総登録数: ${totalCount}`);
  return { processed: names.length, total: names.length, updated, skipped, failed, totalCount };
}
