import { env } from "../config/env";
import { fetchHtml } from "../utils/httpClient";
import { hasNextPage, parseRuleChangeDetailPage, parseRuleChangeListPage } from "./ruleChangeParser";
import {
  getAllCachedListItems,
  getCachedRuleChangeDetail,
  isListCacheFresh,
  markListCacheCrawled,
  saveRuleChangeDetail,
  saveRuleChangeListItems,
} from "./ruleChangeRepository";
import type { RuleChangeDetail, RuleChangeListItem } from "./types";

const MAX_PAGES = 6;

function listPageUrl(pageNum: number): string {
  return pageNum === 1 ? env.DM_RULE_CHANGE_URL : `${env.DM_RULE_CHANGE_URL}page/${pageNum}/`;
}

export async function crawlRuleChangeList(): Promise<RuleChangeListItem[]> {
  const allItems: RuleChangeListItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchHtml(listPageUrl(page));
    allItems.push(...parseRuleChangeListPage(html));
    if (!hasNextPage(html)) break;
  }
  saveRuleChangeListItems(allItems);
  markListCacheCrawled();
  return allItems;
}

export async function ensureRuleChangeListFresh(): Promise<RuleChangeListItem[]> {
  if (isListCacheFresh()) {
    return getAllCachedListItems();
  }
  return crawlRuleChangeList();
}

export async function getRuleChangeDetail(item: RuleChangeListItem): Promise<RuleChangeDetail | null> {
  const cached = getCachedRuleChangeDetail(item.id);
  if (cached) return cached;

  const html = await fetchHtml(item.url);
  const detail = parseRuleChangeDetailPage(html, item.id, item.url);
  if (detail) {
    saveRuleChangeDetail(detail);
  }
  return detail;
}
