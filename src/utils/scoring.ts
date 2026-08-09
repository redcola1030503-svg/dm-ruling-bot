import { normalizeCardName } from "./normalize";

export type MatchCriteria = {
  cardNames: string[];
  ruleConcepts: string[];
  keywords: string[];
};

const SCORE_CARD_NAME_FULL_MATCH = 10;
const SCORE_CARD_NAME_PARTIAL_MATCH = 5;
const SCORE_RULE_CONCEPT_MATCH = 3;
const SCORE_KEYWORD_MATCH = 1;

/**
 * カード名完全一致+10 / 部分一致+5 / ルール用語一致+3 / キーワード一致+1 で関連度を計算する。
 */
export function scoreTextMatch(text: string, criteria: MatchCriteria): number {
  const normalizedText = normalizeCardName(text);
  let score = 0;

  for (const cardName of criteria.cardNames) {
    const normalizedName = normalizeCardName(cardName);
    if (!normalizedName) continue;
    if (normalizedText.includes(normalizedName)) {
      score += SCORE_CARD_NAME_FULL_MATCH;
    } else if (normalizedName.length > 2) {
      const half = normalizedName.slice(0, Math.ceil(normalizedName.length / 2));
      if (normalizedText.includes(half)) {
        score += SCORE_CARD_NAME_PARTIAL_MATCH;
      }
    }
  }

  for (const concept of criteria.ruleConcepts) {
    const normalized = normalizeCardName(concept);
    if (normalized && normalizedText.includes(normalized)) {
      score += SCORE_RULE_CONCEPT_MATCH;
    }
  }

  for (const keyword of criteria.keywords) {
    const normalized = normalizeCardName(keyword);
    if (normalized && normalizedText.includes(normalized)) {
      score += SCORE_KEYWORD_MATCH;
    }
  }

  return score;
}
