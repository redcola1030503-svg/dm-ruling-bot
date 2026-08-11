import { env } from "../config/env";
import { fetchHtml, postForm } from "../utils/httpClient";
import { parseCardDetailPage, parseCardListPage } from "./cardParser";
import { getCachedCard, saveCardToCache } from "./cardRepository";
import type { CardInfo, CardSearchHit } from "./types";

const DEFAULT_MAX_RESULTS = 10;
const MIN_FALLBACK_TOKEN_LENGTH = 2;

// 表記体系(英数字/カタカナ/ひらがな/漢字)の境界で語を分割するための正規表現。
// 例:「VANベートーベン」→「VAN」「ベートーベン」
const SCRIPT_TOKEN_PATTERN =
  /[A-Za-zＡ-Ｚａ-ｚ0-9０-９]+|[ァ-ヶー]+|[一-龠々]+|[ぁ-ん]+/g;

async function searchOnce(keyword: string): Promise<CardSearchHit[]> {
  const form = new URLSearchParams();
  form.set("keyword", keyword);
  form.append("keyword_type[]", "card_name");
  form.append("keyword_type[]", "card_ruby"); // 読み仮名表記ゆれ(ひらがな/カタカナ)にも対応
  form.set("pagenum", "1");

  const html = await postForm(env.DM_CARD_BASE_URL, form);
  return parseCardListPage(html);
}

/**
 * 公式サイトの検索は「・」などの区切り記号の有無に厳格で、ユーザーが中黒を
 * 省略して入力すると完全に0件になることがある(例:「VANベートーベン」)。
 * 空白/中黒で分割した語、さらに表記体系の境界で分割した語を長い順に
 * 再検索候補として返す。
 */
export function extractFallbackTokens(keyword: string): string[] {
  const tokens = new Set<string>();
  for (const part of keyword.split(/[\s　・]+/)) {
    if (part.length >= MIN_FALLBACK_TOKEN_LENGTH) tokens.add(part);
    for (const scriptToken of part.match(SCRIPT_TOKEN_PATTERN) ?? []) {
      if (scriptToken.length >= MIN_FALLBACK_TOKEN_LENGTH) tokens.add(scriptToken);
    }
  }
  tokens.delete(keyword);
  return Array.from(tokens).sort((a, b) => b.length - a.length);
}

export async function searchOfficialCards(
  keyword: string,
  options?: { maxResults?: number },
): Promise<CardSearchHit[]> {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;

  const primaryHits = await searchOnce(keyword);
  if (primaryHits.length > 0) return primaryHits.slice(0, maxResults);

  for (const token of extractFallbackTokens(keyword)) {
    const hits = await searchOnce(token);
    if (hits.length > 0) return hits.slice(0, maxResults);
  }

  return [];
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
