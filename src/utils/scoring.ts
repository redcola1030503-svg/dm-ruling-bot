import { normalizeCardName } from "./normalize";
import { bigramOverlap } from "./textSimilarity";

export type MatchCriteria = {
  cardNames: string[];
  ruleConcepts: string[];
  keywords: string[];
};

const SCORE_CARD_NAME_FULL_MATCH = 10;
const SCORE_CARD_NAME_PARTIAL_MATCH = 5;
const SCORE_RULE_CONCEPT_MATCH = 3;
const SCORE_KEYWORD_MATCH = 1;

// ruleConcepts/keywordsの緩い一致判定に使う閾値。短い語は2-gramの絶対数が
// 少なく、1個の偶然一致だけで割合が高くなってしまう(例:3文字語は2-gramが
// 2個しかなく、1個一致で0.5になる)ため、割合に加えて一致個数の下限も課す。
const OVERLAP_MATCH_THRESHOLD = 0.6;
const MIN_LENGTH_FOR_OVERLAP_MATCH = 4;
const MIN_COMMON_BIGRAMS = 2;

/**
 * 完全な部分文字列一致に加えて、LLMが生成した自然な言い回しと条文の硬い表現の
 * ように字面は違っても意味的に近い場合を、2-gram overlapで緩く拾う。
 */
function fuzzyIncludes(normalizedText: string, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false;
  if (normalizedText.includes(normalizedQuery)) return true;
  if (normalizedQuery.length < MIN_LENGTH_FOR_OVERLAP_MATCH) return false;
  const { ratio, commonCount } = bigramOverlap(normalizedQuery, normalizedText);
  return ratio >= OVERLAP_MATCH_THRESHOLD && commonCount >= MIN_COMMON_BIGRAMS;
}

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
    if (fuzzyIncludes(normalizedText, normalized)) {
      score += SCORE_RULE_CONCEPT_MATCH;
    }
  }

  for (const keyword of criteria.keywords) {
    const normalized = normalizeCardName(keyword);
    if (fuzzyIncludes(normalizedText, normalized)) {
      score += SCORE_KEYWORD_MATCH;
    }
  }

  return score;
}
