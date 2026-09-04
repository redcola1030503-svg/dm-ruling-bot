import { analyzeQuestion } from "./analyzeQuestion";
import { retrieveEvidence } from "./retrieveEvidence";
import { generateRuling } from "./generateRuling";
import type { AmbiguousCard, EvidenceSource, RulingEvidence, RulingResult } from "./types";
import { logger } from "../utils/logger";
import { recordCardQuery, recordSourceReference } from "../stats/statsRepository";

/**
 * 一意に確定できたカードそれぞれについて、質問された回数を記録する。
 * ambiguousCards(候補が絞れなかったもの)は対象外(誤ったカードとして
 * カウントされることを避けるため)。
 */
function recordCardQueries(evidence: RulingEvidence): void {
  for (const card of evidence.cards) {
    recordCardQuery(card.itemKey, card.title, card.url);
  }
}

/**
 * LLMが実際に根拠として採用したsources(url、訂正事例のみtitleで照合)を
 * evidence全体から探し、その種別・個別項目ごとの参照回数を記録する。
 */
function recordSourceReferences(evidence: RulingEvidence, result: RulingResult): void {
  const pool: EvidenceSource[] = [
    ...evidence.cards,
    ...evidence.qa,
    ...evidence.ruleChanges,
    ...evidence.generalRules,
    ...evidence.pastCorrections,
    ...evidence.verifiedRulingPrinciples,
  ];
  const byUrl = new Map(pool.filter((item) => item.url !== "").map((item) => [item.url, item]));
  // pastCorrections・verifiedRulingPrinciplesはurlが空文字のため、タイトルで照合する。
  const byEmptyUrlTitle = new Map(
    [...evidence.pastCorrections, ...evidence.verifiedRulingPrinciples].map((item) => [item.title, item]),
  );

  for (const source of result.sources) {
    const matched = source.url === "" ? byEmptyUrlTitle.get(source.title) : byUrl.get(source.url);
    if (!matched) continue;
    recordSourceReference(matched.sourceType, matched.itemKey, matched.title, matched.url);
  }
}

export type ProduceRulingOutcome =
  | { status: "ok"; result: RulingResult }
  | { status: "evidence_error"; result: RulingResult }
  | { status: "llm_error"; result: RulingResult }
  | { status: "needs_clarification"; result: RulingResult };

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

function ambiguousCardResult(ambiguousCards: AmbiguousCard[]): RulingResult {
  const lines = ambiguousCards.map(
    (a) => `「${a.queried}」→ ${a.candidates.map((name) => `《${name}》`).join(" / ")}`,
  );
  return {
    conclusion: "カード名を確定できませんでした。該当するカードを教えてください。",
    explanation:
      `入力いただいたカード名が公式のカード名と一致しませんでした。誤った裁定を防ぐため、` +
      `以下の候補の中から該当するものを正式名称で教えてください(候補にない場合はその旨もお知らせください)。\n\n${lines.join("\n")}`,
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
    verifiedRulingPrincipleCount: evidence.verifiedRulingPrinciples.length,
    ambiguousCards: evidence.ambiguousCards,
  });

  recordCardQueries(evidence);

  // カード名を一意に確定できない場合、誤ったカードを前提に裁定を生成してしまうと
  // かえって誤答のリスクが高まるため、LLMには回さずユーザーに確認を返す。
  if (evidence.ambiguousCards.length > 0) {
    return { status: "needs_clarification", result: ambiguousCardResult(evidence.ambiguousCards) };
  }

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
    recordSourceReferences(evidence, result);
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
