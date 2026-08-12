import { env } from "../config/env";
import { fetchHtml, postForm } from "../utils/httpClient";
import { parseCardDetailPage, parseCardListPage } from "./cardParser";
import { getCachedCard, saveCardToCache } from "./cardRepository";
import type { CardInfo, CardSearchHit } from "./types";

const DEFAULT_MAX_RESULTS = 10;
const MIN_FALLBACK_TOKEN_LENGTH = 2;
// 表記体系境界でも分割できない単一の語塊(カタカナの中黒省略等)に対して、
// 先頭からの部分文字列を短くしていく際にこれより短くは削らない
// (短すぎる語は無関係なカードが大量にヒットし、有効なfallbackにならない)。
const MIN_PREFIX_SHRINK_LENGTH = 3;
// 中黒結合クエリ(refineWithRemainder)はAND検索により既に十分絞り込まれて
// いるため、通常のmaxResultsより広めに取得する。maxResults(既定5)のまま
// 切り詰めると、目的のカードがAND検索結果の中で後方に位置する場合
// (例:「ボルシャック・ドラゴン」がシリーズカードに埋もれて7件目になる)に
// 取りこぼしてしまうため。
const REFINE_MAX_RESULTS = 20;

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
    const scriptTokens = part.match(SCRIPT_TOKEN_PATTERN) ?? [];
    for (const scriptToken of scriptTokens) {
      if (scriptToken.length >= MIN_FALLBACK_TOKEN_LENGTH) tokens.add(scriptToken);
    }
    // 区切り記号でも表記体系境界でも分割できない単一の語塊(例:「セイント・
    // キャッスル」の中黒を省略した「セイントキャッスル」)は、公式サイトの
    // 検索が任意の部分文字列ではなく単語単位でマッチするため、そのままでは
    // 0件になることがある。先頭からの部分文字列を短くした候補を追加し、
    // 単語の切れ目をsearchOfficialCards側で探索できるようにする。
    if (scriptTokens.length === 1 && scriptTokens[0] === part) {
      for (let len = part.length - 1; len >= MIN_PREFIX_SHRINK_LENGTH; len--) {
        tokens.add(part.slice(0, len));
      }
    }
  }
  tokens.delete(keyword);
  return Array.from(tokens).sort((a, b) => b.length - a.length);
}

/**
 * fallbackトークンでヒットが得られた場合、そのトークンが元のkeywordの
 * 接頭辞または接尾辞であれば、残りの部分と中黒(・)で結合したクエリを
 * 追加で試す。公式サイトの検索は中黒区切りのキーワードをAND検索するため、
 * 単語の切れ目さえ特定できれば元のカード名によりピンポイントでヒットできる
 * (例:「ボルシャック」がヒット→残り「ドラゴン」→「ボルシャック・ドラゴン」)。
 * これが無いと、一般的すぎる語(「ボルシャック」等)は該当カードが同名の
 * 別カード群に埋もれてしまい、上位maxResults件に入らないことがある。
 */
async function refineWithRemainder(keyword: string, token: string): Promise<CardSearchHit[] | null> {
  let remainder: string | null = null;
  let combinedQuery: string | null = null;
  if (keyword.startsWith(token)) {
    remainder = keyword.slice(token.length);
    combinedQuery = `${token}・${remainder}`;
  } else if (keyword.endsWith(token)) {
    remainder = keyword.slice(0, keyword.length - token.length);
    combinedQuery = `${remainder}・${token}`;
  }
  if (!remainder || remainder.length < MIN_FALLBACK_TOKEN_LENGTH || !combinedQuery) return null;

  const combinedHits = await searchOnce(combinedQuery);
  return combinedHits.length > 0 ? combinedHits.slice(0, REFINE_MAX_RESULTS) : null;
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
    if (hits.length === 0) continue;

    const refinedHits = await refineWithRemainder(keyword, token);
    if (refinedHits) return refinedHits;
    return hits.slice(0, maxResults);
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
