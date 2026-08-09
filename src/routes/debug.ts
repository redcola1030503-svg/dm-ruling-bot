import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { extractCardNameCandidates } from "../cards/extractCardNameCandidates";
import { findCardCandidates } from "../cards/cardNameMatcher";
import { extractRuleConcepts } from "../rules/ruleConceptDictionary";
import { searchAndRankQa } from "../rules/qaRanking";
import { searchAndRankRuleChanges } from "../rules/ruleChangeRanking";
import { analyzeQuestion } from "../ruling/analyzeQuestion";
import { logger } from "../utils/logger";

export const debugRouter = Router();

const debugSearchSchema = z.object({
  question: z.string().min(1).max(1000),
});

// NODE_ENV=production の場合は ENABLE_DEBUG_ROUTES の設定値に関わらず必ず無効化する
// (本番用.envへのコピペミスでデバッグルートが露出する事故を防ぐための多層防御)
const debugRoutesEnabled = env.ENABLE_DEBUG_ROUTES && env.NODE_ENV !== "production";

if (env.ENABLE_DEBUG_ROUTES && !debugRoutesEnabled) {
  logger.warn("debug_routes_forced_disabled_in_production", {
    reason: "NODE_ENV=production かつ ENABLE_DEBUG_ROUTES=true のため強制無効化しました",
  });
}

if (debugRoutesEnabled) {
  debugRouter.post("/api/debug/search", async (req, res) => {
    const parsed = debugSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const { question } = parsed.data;
    const candidateNames = extractCardNameCandidates(question);
    const namesToSearch = candidateNames.length > 0 ? candidateNames : [question];
    const ruleConcepts = extractRuleConcepts(question);

    try {
      const cards = await Promise.all(
        namesToSearch.map(async (name) => ({
          queried: name,
          matches: await findCardCandidates(name),
        })),
      );

      const criteria = { cardNames: candidateNames, ruleConcepts, keywords: [] };
      const [qa, ruleChanges] = await Promise.all([
        searchAndRankQa(criteria),
        searchAndRankRuleChanges(criteria),
      ]);

      res.json({ cards, qa, ruleChanges });
    } catch (error) {
      logger.error("debug_search_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({ error: "official_site_unreachable" });
    }
  });

  debugRouter.post("/api/debug/analyze", async (req, res) => {
    const parsed = debugSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    try {
      const result = await analyzeQuestion(parsed.data.question);
      res.json({
        cards: result.cardNames,
        keywords: result.keywords,
        ruleConcepts: result.ruleConcepts,
        situation: result.situation,
        question: result.question,
      });
    } catch (error) {
      logger.error("debug_analyze_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({ error: "analysis_failed" });
    }
  });
}
