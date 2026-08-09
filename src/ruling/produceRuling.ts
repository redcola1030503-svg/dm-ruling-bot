import { analyzeQuestion } from "./analyzeQuestion";
import { retrieveEvidence } from "./retrieveEvidence";
import { generateRuling } from "./generateRuling";
import type { RulingResult } from "./types";
import { logger } from "../utils/logger";

export type ProduceRulingOutcome =
  | { status: "ok"; result: RulingResult }
  | { status: "evidence_error"; result: RulingResult }
  | { status: "llm_error"; result: RulingResult };

const LOG_TEXT_MAX_LENGTH = 200;

function officialSiteUnreachableResult(): RulingResult {
  return {
    conclusion: "現在、公式情報を取得できませんでした。",
    explanation:
      "誤った裁定を返す可能性があるため、今回は回答を保留します。時間を置いて再度お試しください。",
    steps: [],
    confidence: "low",
    cards: [],
    sources: [],
  };
}

function llmFailedResult(): RulingResult {
  return {
    conclusion: "裁定の解析中にエラーが発生しました。",
    explanation: "公式情報を確認できなかったため、回答を生成していません。",
    steps: [],
    confidence: "low",
    cards: [],
    sources: [],
  };
}

export async function produceRuling(question: string): Promise<ProduceRulingOutcome> {
  const startedAt = Date.now();
  const parsedQuestion = await analyzeQuestion(question);

  logger.info("question_analyzed", {
    question: question.slice(0, LOG_TEXT_MAX_LENGTH),
    cardNames: parsedQuestion.cardNames,
    keywords: parsedQuestion.keywords,
    ruleConcepts: parsedQuestion.ruleConcepts,
  });

  let evidence;
  try {
    evidence = await retrieveEvidence(parsedQuestion);
  } catch (error) {
    logger.error("evidence_retrieval_failed", {
      question: question.slice(0, LOG_TEXT_MAX_LENGTH),
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    return { status: "evidence_error", result: officialSiteUnreachableResult() };
  }

  logger.info("evidence_retrieved", {
    cardUrls: evidence.cards.map((c) => c.url),
    qaUrls: evidence.qa.map((q) => q.url),
    ruleChangeUrls: evidence.ruleChanges.map((r) => r.url),
    generalRuleNumbers: evidence.generalRules.map((r) => r.title),
    pastCorrectionCount: evidence.pastCorrections.length,
  });

  try {
    const result = await generateRuling(parsedQuestion, evidence);
    logger.info("ruling_generated", {
      conclusion: result.conclusion.slice(0, LOG_TEXT_MAX_LENGTH),
      confidence: result.confidence,
      cardCount: evidence.cards.length,
      qaCount: evidence.qa.length,
      ruleChangeCount: evidence.ruleChanges.length,
      generalRuleCount: evidence.generalRules.length,
      elapsedMs: Date.now() - startedAt,
    });
    return { status: "ok", result };
  } catch (error) {
    logger.error("llm_generation_failed", {
      question: question.slice(0, LOG_TEXT_MAX_LENGTH),
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    return { status: "llm_error", result: llmFailedResult() };
  }
}
