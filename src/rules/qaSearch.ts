import axios from "axios";
import { env } from "../config/env";
import { fetchHtml, postForm } from "../utils/httpClient";
import { parseCardQaListPage, parseQaDetailPage, parseQaListPage } from "./qaParser";
import { getCachedQa, saveQaToCache } from "./qaRepository";
import type { QaDetail, QaListItem } from "./types";

const DEFAULT_MAX_RESULTS = 10;

// 公式サイトのQ&A検索は1ページあたり10件しか返さず、ページネーションはURLパス
// (/page/N/)で行う(実測値)。「侵略」のように多数のカードでヒットする一般的な
// キーワードだと、質問と一致するQ&Aが1ページ目に収まらないことがある
// (例:「侵略」で検索すると質問と同一のQ&A(42940)が5ページ目に出る)ため、
// maxResultsに応じて複数ページを取得する。
const RESULTS_PER_PAGE = 10;

async function searchQaPage(keyword: string, pagenum: number): Promise<QaListItem[]> {
  const form = new URLSearchParams();
  form.set("qa_w", keyword);
  form.set("qa_pt", "");
  form.set("qa_prod", "");
  form.set("qa_type", "0"); // 0=通常のQ&A, 1=デュエパーティー専用Q&A

  const baseUrl = env.DM_QA_URL.endsWith("/") ? env.DM_QA_URL : `${env.DM_QA_URL}/`;
  const url = pagenum > 1 ? `${baseUrl}page/${pagenum}/` : baseUrl;
  try {
    const html = await postForm(url, form);
    return parseQaListPage(html);
  } catch (error) {
    // ヒット件数がRESULTS_PER_PAGE未満のキーワードだと、2ページ目以降は
    // 存在せず404になる(=それ以上結果がないだけで、検索自体の失敗ではない)。
    // 1ページ目の404は本当の失敗(検索エンドポイント自体の異常)なので区別する。
    if (pagenum > 1 && axios.isAxiosError(error) && error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * QA全件クロール(qaIndexCrawler.ts)用。keywordを空にすると全Q&Aが対象になり、
 * pagenumを進めることで次ページを取得できる(公式サイトで実機確認済み)。
 */
export async function fetchQaListPage(keyword: string, pagenum: number): Promise<QaListItem[]> {
  return searchQaPage(keyword, pagenum);
}

export async function searchQaByKeyword(
  keyword: string,
  options?: { maxResults?: number },
): Promise<QaListItem[]> {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const pageCount = Math.max(1, Math.ceil(maxResults / RESULTS_PER_PAGE));

  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => searchQaPage(keyword, i + 1)),
  );
  return pages.flat().slice(0, maxResults);
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
