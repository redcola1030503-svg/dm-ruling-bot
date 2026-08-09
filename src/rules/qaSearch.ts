import { env } from "../config/env";
import { fetchHtml, postForm } from "../utils/httpClient";
import { parseCardQaListPage, parseQaDetailPage, parseQaListPage } from "./qaParser";
import { getCachedQa, saveQaToCache } from "./qaRepository";
import type { QaDetail, QaListItem } from "./types";

const DEFAULT_MAX_RESULTS = 10;

export async function searchQaByKeyword(
  keyword: string,
  options?: { maxResults?: number },
): Promise<QaListItem[]> {
  const form = new URLSearchParams();
  form.set("qa_w", keyword);
  form.set("qa_pt", "");
  form.set("qa_prod", "");
  form.set("qa_type", "0"); // 0=通常のQ&A, 1=デュエパーティー専用Q&A

  const html = await postForm(env.DM_QA_URL, form);
  const items = parseQaListPage(html);
  return items.slice(0, options?.maxResults ?? DEFAULT_MAX_RESULTS);
}

/**
 * カード詳細ページに埋め込まれた「このカードのよくある質問」一覧を取得する。
 * 公式が手動でカードと紐付けたQ&Aのため、キーワード検索より関連度が高い。
 */
export async function fetchQaListForCard(
  qaListUrl: string,
  options?: { maxResults?: number },
): Promise<QaListItem[]> {
  const html = await fetchHtml(qaListUrl);
  const items = parseCardQaListPage(html);
  return items.slice(0, options?.maxResults ?? DEFAULT_MAX_RESULTS);
}

export async function getQaDetail(item: QaListItem): Promise<QaDetail | null> {
  const cached = getCachedQa(item.id);
  if (cached) return cached;

  const html = await fetchHtml(item.url);
  const detail = parseQaDetailPage(html, item.id, item.url);
  if (detail) {
    saveQaToCache(detail);
  }
  return detail;
}
