import { scoreTextMatch, type MatchCriteria } from "../utils/scoring";
import { ensureGeneralRuleFresh } from "./generalRuleSearch";
import type { GeneralRuleEvidence } from "./types";

export type GeneralRuleSearchCriteria = MatchCriteria;

const DEFAULT_TOP_N = 5;
const MAX_PROCESSING_ORDER_EXTRAS = 10;

// 「複数の保留/誘発型能力をどの順序で処理するか」という一般原則を扱う条文群
// (S・トリガー等の優先順位、保留状態の扱い、誘発型能力のターンプレイヤー優先)。
// 具体的なカード名やキーワードを含まないため、通常のキーワード一致スコアでは
// S・トリガーやシールドといった語を多く含む具体的な条文に埋もれて上位に
// 出てきにくいが、複数カードが絡む状況では裁定の決め手になることが多いため、
// スコア(>0)がつく限り通常のtopN件とは別枠で必ず候補に含める。
const PROCESSING_ORDER_RULE_PREFIXES = ["101.4", "409", "603.2", "603.3"];

function isProcessingOrderRule(ruleNumber: string): boolean {
  return PROCESSING_ORDER_RULE_PREFIXES.some((prefix) => ruleNumber.startsWith(prefix));
}

export async function searchAndRankGeneralRules(
  criteria: GeneralRuleSearchCriteria,
  options?: { topN?: number },
): Promise<GeneralRuleEvidence[]> {
  const hasAnyCriteria =
    criteria.cardNames.length + criteria.ruleConcepts.length + criteria.keywords.length > 0;
  if (!hasAnyCriteria) return [];

  const chunks = await ensureGeneralRuleFresh();

  const scored: GeneralRuleEvidence[] = chunks
    .map((chunk) => ({ ...chunk, score: scoreTextMatch(chunk.text, criteria) }))
    .filter((chunk) => chunk.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const topN = options?.topN ?? DEFAULT_TOP_N;
  const primary = scored.slice(0, topN);
  const primaryRuleNumbers = new Set(primary.map((chunk) => chunk.ruleNumber));

  const processingOrderExtras = scored
    .filter((chunk) => !primaryRuleNumbers.has(chunk.ruleNumber) && isProcessingOrderRule(chunk.ruleNumber))
    .slice(0, MAX_PROCESSING_ORDER_EXTRAS);

  return [...primary, ...processingOrderExtras];
}
