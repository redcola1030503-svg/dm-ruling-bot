import { env } from "../config/env";
import { logger } from "../utils/logger";
import { searchAndRankGeneralRules, type GeneralRuleSearchCriteria } from "../rules/generalRuleRanking";
import { semanticSearchGeneralRules } from "./semanticSearch";

// スコアのスケールが異なる2つの検索(keywordScoreは0〜数十点の整数、
// embeddingScoreはコサイン類似度0〜1)を、生スコアのmin-max正規化ではなく
// 「順位」で統合するReciprocal Rank Fusion(RRF)を採用する。生スコアの正規化は
// 候補集合ごとの分布の偏り(例:1件しかヒットしない場合など)に弱く不安定に
// なりやすいが、RRFは順位だけに依存するため安定して動作する。
const RRF_K = 60;

export type HybridSearchResult = {
  ruleNumber: string;
  text: string;
  keywordScore: number;
  embeddingScore: number;
  finalScore: number;
};

function reciprocalRankScore(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

type MergedEntry = {
  text: string;
  keywordScore: number;
  embeddingScore: number;
  keywordRank?: number;
  semanticRank?: number;
};

/**
 * 既存のキーワード検索と、embeddingによる意味検索を統合したハイブリッド検索。
 * embedding検索(Voyage API呼び出し)が失敗しても例外を外へ伝播させず、
 * キーワード検索のみの結果にフォールバックする(Bot全体を止めないため)。
 */
export async function hybridSearchGeneralRules(
  question: string,
  criteria: GeneralRuleSearchCriteria,
  options?: { finalResultCount?: number },
): Promise<HybridSearchResult[]> {
  const semanticCandidateCount = env.SEARCH_SEMANTIC_CANDIDATES;
  const keywordResults = await searchAndRankGeneralRules(criteria, { topN: semanticCandidateCount });

  // searchAndRankGeneralRulesは、topN件に加えて「複数の保留/誘発型能力の処理
  // 順序を扱う一般原則条文」をスコアに関わらず別枠で必ず含めて返す
  // (generalRuleRanking.ts参照)。この別枠分をRRFの順位計算に混ぜると、
  // 配列末尾の低い順位として扱われ不当にスコアが低くなってしまうため、
  // primary(topN以内、順位に意味がある)とextras(別枠、順位に意味がない)を
  // 区別し、extrasはRRFのスコアに関わらず最終結果に必ず残す。
  const keywordPrimary = keywordResults.slice(0, semanticCandidateCount);
  const keywordExtras = keywordResults.slice(semanticCandidateCount);

  let semanticResults: Awaited<ReturnType<typeof semanticSearchGeneralRules>> = [];
  try {
    semanticResults = await semanticSearchGeneralRules(question, semanticCandidateCount);
  } catch (error) {
    logger.error("semantic_search_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    semanticResults = [];
  }

  const merged = new Map<string, MergedEntry>();

  keywordPrimary.forEach((result, rank) => {
    merged.set(result.ruleNumber, {
      text: result.text,
      keywordScore: result.score,
      embeddingScore: 0,
      keywordRank: rank,
    });
  });

  semanticResults.forEach((result, rank) => {
    const existing = merged.get(result.ruleNumber);
    if (existing) {
      existing.embeddingScore = result.embeddingScore;
      existing.semanticRank = rank;
    } else {
      merged.set(result.ruleNumber, {
        text: result.text,
        keywordScore: 0,
        embeddingScore: result.embeddingScore,
        semanticRank: rank,
      });
    }
  });

  const rankedResults: HybridSearchResult[] = Array.from(merged.entries()).map(([ruleNumber, entry]) => {
    const keywordRrf = entry.keywordRank !== undefined ? reciprocalRankScore(entry.keywordRank) : 0;
    const semanticRrf = entry.semanticRank !== undefined ? reciprocalRankScore(entry.semanticRank) : 0;
    return {
      ruleNumber,
      text: entry.text,
      keywordScore: entry.keywordScore,
      embeddingScore: entry.embeddingScore,
      finalScore: keywordRrf * env.SEARCH_KEYWORD_WEIGHT + semanticRrf * env.SEARCH_EMBEDDING_WEIGHT,
    };
  });

  rankedResults.sort((a, b) => b.finalScore - a.finalScore);

  const finalResultCount = options?.finalResultCount ?? env.SEARCH_FINAL_RESULTS;
  const primaryFinal = rankedResults.slice(0, finalResultCount);
  const includedRuleNumbers = new Set(primaryFinal.map((r) => r.ruleNumber));

  // 処理順序系の別枠条文(keywordExtras)は、RRFスコアの上下に関わらず必ず
  // 最終結果へ残す。finalScoreはRRF統合の枠外のため0のまま(順位を持たない)。
  const mustIncludeExtras: HybridSearchResult[] = keywordExtras
    .filter((extra) => !includedRuleNumbers.has(extra.ruleNumber))
    .map((extra) => ({
      ruleNumber: extra.ruleNumber,
      text: extra.text,
      keywordScore: extra.score,
      embeddingScore: merged.get(extra.ruleNumber)?.embeddingScore ?? 0,
      finalScore: 0,
    }));

  const finalResults = [...primaryFinal, ...mustIncludeExtras];

  if (env.NODE_ENV !== "production") {
    logger.info("hybrid_search_debug", {
      question: question.slice(0, 100),
      top: finalResults.map((r) => ({
        ruleNumber: r.ruleNumber,
        keywordScore: r.keywordScore,
        embeddingScore: Number(r.embeddingScore.toFixed(3)),
        finalScore: Number(r.finalScore.toFixed(4)),
      })),
    });
  }

  return finalResults;
}
