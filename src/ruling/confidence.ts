import type { Confidence, RulingEvidence } from "./types";

/**
 * confidence判定の目安:
 * high   = 事象が当てはまる総合ルールの条文が明確に存在する、
 *          または質問とほぼ同じ公式Q&Aが存在する、またはルール変更に明確な記述がある
 * medium = カードテキスト+総合ルール+類似Q&Aから明確に判断可能
 * low    = 直接対応する公式ルール・Q&Aがなく、複数ルールを組み合わせて推論している
 */
export function estimateConfidence(evidence: RulingEvidence): Confidence {
  const hasStrongGeneralRuleMatch = evidence.generalRules.some((rule) => rule.score >= 10);
  const hasStrongQaMatch = evidence.qa.some((qa) => qa.score >= 10);
  const hasRuleChangeMatch = evidence.ruleChanges.length > 0;
  // 公認ジャッジによる訂正実績は公式総合ルール・公式Q&Aと同等の一次資料として扱うため、
  // 強い一致(論点が明確に合致)であれば同様にhigh評価の材料にする。
  const hasStrongCorrectionMatch = evidence.pastCorrections.some((correction) => correction.score >= 10);

  if (hasStrongGeneralRuleMatch || hasStrongQaMatch || hasRuleChangeMatch || hasStrongCorrectionMatch) {
    return "high";
  }

  const hasSomeGeneralRuleMatch = evidence.generalRules.length > 0;
  const hasSomeQaMatch = evidence.qa.length > 0;
  const hasSomeCorrectionMatch = evidence.pastCorrections.length > 0;
  const hasCardText = evidence.cards.length > 0;

  if (hasCardText && (hasSomeQaMatch || hasSomeGeneralRuleMatch || hasSomeCorrectionMatch)) {
    return "medium";
  }

  return "low";
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * 2つのconfidenceのうち、より慎重な(低い)方を返す。
 * Evidenceのキーワードスコアだけでは「カード名は一致しているが論点が違う」ような
 * 誤った高confidenceを防げないため、LLM自身の自己評価と組み合わせて安全側に倒す。
 */
export function pickMoreCautious(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}
