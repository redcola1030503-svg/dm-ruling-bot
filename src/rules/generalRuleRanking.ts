import { scoreTextMatch, type MatchCriteria } from "../utils/scoring";
import { ensureGeneralRuleFresh } from "./generalRuleSearch";
import type { GeneralRuleEvidence } from "./types";

export type GeneralRuleSearchCriteria = MatchCriteria;

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
  return scored.slice(0, options?.topN ?? 5);
}
