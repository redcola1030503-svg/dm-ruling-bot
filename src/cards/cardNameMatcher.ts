import { normalizeCardName } from "../utils/normalize";
import { similarityScore } from "../utils/textSimilarity";
import { extractFallbackTokens, getOfficialCard, searchOfficialCards } from "./cardSearch";
import type { CardInfo, CardSearchHit } from "./types";

export type CardMatchType = "exact" | "prefix" | "partial" | "fuzzy";

export type CardNameMatch = {
  card: CardInfo;
  matchType: CardMatchType;
  score: number;
};

const FUZZY_MIN_SCORE = 0.5;
// この閾値以上のスコアを「十分な一致」とみなす。公式サイト検索は0件ではなく
// 無関係な候補を返してくることがある(例:「奇石 ミクセル / ジャミング・チャフ」
// のようなスラッシュを含む複合カード名)ため、既存の候補がこの閾値に届かない
// 場合はフォールバックトークンでの再検索を試みる。
const SUFFICIENT_MATCH_SCORE = 0.75;

function scoreCardsAgainst(cards: CardInfo[], inputName: string): CardNameMatch[] {
  const normalizedInput = normalizeCardName(inputName);
  const matches: CardNameMatch[] = [];

  for (const card of cards) {
    const normalizedName = normalizeCardName(card.name);

    if (normalizedName === normalizedInput) {
      matches.push({ card, matchType: "exact", score: 1 });
      continue;
    }
    if (normalizedName.startsWith(normalizedInput) || normalizedInput.startsWith(normalizedName)) {
      matches.push({ card, matchType: "prefix", score: 0.9 });
      continue;
    }
    if (normalizedName.includes(normalizedInput) || normalizedInput.includes(normalizedName)) {
      matches.push({ card, matchType: "partial", score: 0.75 });
      continue;
    }
    const similarity = similarityScore(normalizedName, normalizedInput);
    if (similarity >= FUZZY_MIN_SCORE) {
      matches.push({ card, matchType: "fuzzy", score: similarity * 0.6 });
    }
  }

  return matches;
}

async function fetchCards(hits: CardSearchHit[]): Promise<CardInfo[]> {
  return (await Promise.all(hits.map((hit) => getOfficialCard(hit)))).filter(
    (card): card is CardInfo => card !== null,
  );
}

function bestScore(matches: CardNameMatch[]): number {
  return matches.reduce((max, m) => Math.max(max, m.score), -Infinity);
}

export async function findCardCandidates(
  inputName: string,
  options?: { maxResults?: number },
): Promise<CardNameMatch[]> {
  const hits = await searchOfficialCards(inputName, options);
  const cards = await fetchCards(hits);
  let matches = scoreCardsAgainst(cards, inputName);

  const seenIds = new Set(cards.map((card) => card.id));
  if (bestScore(matches) < SUFFICIENT_MATCH_SCORE) {
    for (const token of extractFallbackTokens(inputName)) {
      const fallbackHits = await searchOfficialCards(token, options);
      const newCards = (await fetchCards(fallbackHits)).filter((card) => !seenIds.has(card.id));
      for (const card of newCards) seenIds.add(card.id);

      matches = matches.concat(scoreCardsAgainst(newCards, inputName));
      if (bestScore(matches) >= SUFFICIENT_MATCH_SCORE) break;
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}
