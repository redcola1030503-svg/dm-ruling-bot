import { env } from "../config/env";
import { fetchHtml, postForm } from "../utils/httpClient";
import { parseCardDetailPage, parseCardListPage, parseTotalCount } from "./cardParser";
import { getCachedCard, saveCardToCache } from "./cardRepository";
import type { CardInfo, CardSearchHit } from "./types";

const DEFAULT_MAX_RESULTS = 10;

async function searchOnce(keyword: string, pagenum = 1): Promise<CardSearchHit[]> {
  const form = new URLSearchParams();
  form.set("keyword", keyword);
  form.append("keyword_type[]", "card_name");
  form.append("keyword_type[]", "card_ruby"); // 読み仮名表記ゆれ(ひらがな/カタカナ)にも対応
  form.set("pagenum", String(pagenum));

  const html = await postForm(env.DM_CARD_BASE_URL, form);
  return parseCardListPage(html);
}

/**
 * カード名一覧の全件クロール(buildCardIndex.ts)用。keywordを空にすると
 * 全カードが対象になり、pagenumを進めることで次ページを取得できる
 * (公式サイトで実機確認済み)。
 */
export async function fetchCardListPage(keyword: string, pagenum: number): Promise<CardSearchHit[]> {
  return searchOnce(keyword, pagenum);
}

/**
 * 公式サイトの全カード数(total_count)を1リクエストだけで取得する。
 * フル再クロールをせずに「新カードが追加された可能性」を軽量に検知する用途
 * (card_index更新チェック)。件数比較のみのため、既存カードのテキスト修正
 * (エラッタ)や、廃番と新規追加が相殺されるケースは検知できない点に注意。
 */
export async function fetchTotalCardCount(): Promise<number | null> {
  const form = new URLSearchParams();
  form.set("keyword", "");
  form.append("keyword_type[]", "card_name");
  form.append("keyword_type[]", "card_ruby");
  form.set("pagenum", "1");

  const html = await postForm(env.DM_CARD_BASE_URL, form);
  return parseTotalCount(html);
}

/**
 * カード名はモバイルアプリの事前構築インデックス(card_index)からのサジェスト
 * 選択、またはLINE入力時のコピペにより正式名称で渡されることを前提とする。
 * 表記ゆれのfallback探索は行わず、公式サイト検索の結果をそのまま返す。
 */
export async function searchOfficialCards(
  keyword: string,
  options?: { maxResults?: number },
): Promise<CardSearchHit[]> {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const hits = await searchOnce(keyword);
  return hits.slice(0, maxResults);
}

export async function getOfficialCard(hit: CardSearchHit): Promise<CardInfo | null> {
  const cached = getCachedCard(hit.id);
  if (cached) return cached;

  const html = await fetchHtml(hit.url);
  const card = parseCardDetailPage(html, hit.id, hit.url);
  if (card) {
    saveCardToCache(card);
  }
  return card;
}
