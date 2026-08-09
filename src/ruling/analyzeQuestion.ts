import { z } from "zod";
import { completeJson } from "../llm/client";
import { extractJsonBlock } from "../llm/jsonExtract";
import { extractCardNameCandidates } from "../cards/extractCardNameCandidates";
import { extractRuleConcepts } from "../rules/ruleConceptDictionary";
import type { ParsedQuestion } from "./types";

const ANALYZE_SYSTEM_PROMPT = `あなたはデュエル・マスターズのルール質問を構造化するアシスタントです。
ユーザーの質問文を分析し、以下のJSON形式のみを出力してください。JSON以外の文字列(説明文、コードブロックの前後の文章)は一切出力しないでください。

{
  "cardNames": string[],
  "keywords": string[],
  "ruleConcepts": string[],
  "situation": string,
  "question": string
}

各フィールドの意味:
- cardNames: 質問文に登場するカード名(《》『』「」で明示されているものを最優先。表記ゆれや略称もそのまま含めてよい)
- keywords: 裁定判断に重要な語句(能力名、キーワード能力など)
- ruleConcepts: ルール用語(例: S・トリガー、置換効果、出た時、離れた時、同時、など)
- situation: 質問が説明しているゲーム状況の要約(1〜2文)
- question: 結局何を聞かれているかの要約(1文)`;

const parsedQuestionSchema = z.object({
  cardNames: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  ruleConcepts: z.array(z.string()).default([]),
  situation: z.string().default(""),
  question: z.string().default(""),
});

export async function analyzeQuestion(originalText: string): Promise<ParsedQuestion> {
  try {
    const raw = await completeJson({
      system: ANALYZE_SYSTEM_PROMPT,
      userMessage: originalText,
    });
    const parsed = parsedQuestionSchema.parse(JSON.parse(extractJsonBlock(raw)));

    // LLMが見落とした場合に備え、括弧表記とルール用語辞書からの抽出も統合する。
    const mergedCardNames = Array.from(
      new Set([...parsed.cardNames, ...extractCardNameCandidates(originalText)]),
    );
    const mergedRuleConcepts = Array.from(
      new Set([...parsed.ruleConcepts, ...extractRuleConcepts(originalText)]),
    );

    return {
      originalText,
      cardNames: mergedCardNames,
      keywords: parsed.keywords,
      ruleConcepts: mergedRuleConcepts,
      situation: parsed.situation,
      question: parsed.question || originalText,
    };
  } catch {
    // LLMによる構造化に失敗した場合は、ルールベースの簡易抽出にフォールバックする。
    // (公式情報取得自体のフォールバックではなく、質問の前処理段階のフォールバックのため許容する)
    return {
      originalText,
      cardNames: extractCardNameCandidates(originalText),
      keywords: [],
      ruleConcepts: extractRuleConcepts(originalText),
      situation: "",
      question: originalText,
    };
  }
}
