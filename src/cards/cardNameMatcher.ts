import { normalizeCardName } from "../utils/normalize";
import { similarityScore } from "../utils/textSimilarity";
import { getOfficialCard, searchOfficialCards } from "./cardSearch";
import type { CardInfo, CardSearchHit } from "./types";

export type CardMatchType = "exact" | "prefix" | "partial" | "fuzzy";

export type CardNameMatch = {
  card: CardInfo;
  matchType: CardMatchType;
  score: number;
};

const FUZZY_MIN_SCORE = 0.5;

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

export async function findCardCandidates(
  inputName: string,
  options?: { maxResults?: number },
): Promise<CardNameMatch[]> {
  // maxResultsは検索結果の絞り込みではなく、スコアリング後の絞り込みに使う。
  // 公式サイト検索の結果順は関連度順ではないため、先に絞り込むと
  // 名称完全一致のカードが件数制限で切り捨てられることがある
  // (例:「ボルシャック・ドラゴン」で検索すると派生カードが多く、
  // 完全一致の本家カードが検索結果の後方に出る)。
  const hits = await searchOfficialCards(inputName);
  const cards = await fetchCards(hits);
  const matches = scoreCardsAgainst(cards, inputName);
  matches.sort((a, b) => b.score - a.score);
  return options?.maxResults ? matches.slice(0, options.maxResults) : matches;
}
