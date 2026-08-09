import { scoreTextMatch, type MatchCriteria } from "../utils/scoring";
import { getAllCorrections } from "./repository";
import type { CorrectionEvidence } from "./types";

export function searchAndRankCorrections(
  criteria: MatchCriteria,
  options?: { topN?: number },
): CorrectionEvidence[] {
  const hasAnyCriteria =
    criteria.cardNames.length + criteria.ruleConcepts.length + criteria.keywords.length > 0;
  if (!hasAnyCriteria) return [];

  const all = getAllCorrections();

  const scored: CorrectionEvidence[] = all
    .map((correction) => ({
      ...correction,
      score: scoreTextMatch(`${correction.originalQuestion} ${correction.correctRuling}`, criteria),
    }))
    .filter((correction) => correction.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options?.topN ?? 5);
}
