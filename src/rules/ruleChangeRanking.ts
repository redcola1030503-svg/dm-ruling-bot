import { normalizeCardName } from "../utils/normalize";
import { scoreTextMatch, type MatchCriteria } from "../utils/scoring";
import { ensureRuleChangeListFresh, getRuleChangeDetail } from "./ruleChangeSearch";
import type { RuleChangeDetail, RuleChangeEvidence } from "./types";

export type RuleChangeSearchCriteria = MatchCriteria;

export async function searchAndRankRuleChanges(
  criteria: RuleChangeSearchCriteria,
  options?: { topN?: number; maxCandidates?: number },
): Promise<RuleChangeEvidence[]> {
  const searchTerms = [...criteria.cardNames, ...criteria.ruleConcepts, ...criteria.keywords]
    .map((term) => normalizeCardName(term))
    .filter((term) => term.length > 0);

  if (searchTerms.length === 0) return [];

  const listItems = await ensureRuleChangeListFresh();

  const candidates = listItems.filter((item) => {
    const normalizedTitle = normalizeCardName(item.title);
    return searchTerms.some((term) => normalizedTitle.includes(term));
  });

  const limited = candidates.slice(0, options?.maxCandidates ?? 10);

  const details = (await Promise.all(limited.map((item) => getRuleChangeDetail(item)))).filter(
    (detail): detail is RuleChangeDetail => detail !== null,
  );

  const scored: RuleChangeEvidence[] = details.map((detail) => ({
    ...detail,
    score: scoreTextMatch(`${detail.title} ${detail.body}`, criteria),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options?.topN ?? 5);
}
