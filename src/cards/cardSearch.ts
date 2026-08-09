import { env } from "../config/env";
import { fetchHtml, postForm } from "../utils/httpClient";
import { parseCardDetailPage, parseCardListPage } from "./cardParser";
import { getCachedCard, saveCardToCache } from "./cardRepository";
import type { CardInfo, CardSearchHit } from "./types";

const DEFAULT_MAX_RESULTS = 10;

export async function searchOfficialCards(
  keyword: string,
  options?: { maxResults?: number },
): Promise<CardSearchHit[]> {
  const form = new URLSearchParams();
  form.set("keyword", keyword);
  form.append("keyword_type[]", "card_name");
  form.append("keyword_type[]", "card_ruby"); // 読み仮名表記ゆれ(ひらがな/カタカナ)にも対応
  form.set("pagenum", "1");

  const html = await postForm(env.DM_CARD_BASE_URL, form);
  const hits = parseCardListPage(html);
  return hits.slice(0, options?.maxResults ?? DEFAULT_MAX_RESULTS);
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
