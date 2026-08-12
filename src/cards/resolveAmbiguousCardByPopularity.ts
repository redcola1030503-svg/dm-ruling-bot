import { getAnthropicClient } from "../llm/client";
import { logger } from "../utils/logger";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
const WEB_SEARCH_MAX_USES = 3;
const REASON_LOG_MAX_LENGTH = 200;

type PopularityConfidence = "very_high" | "moderate" | "low" | "unclear";

interface PopularityResolution {
  resolvedCardName: string | null;
  confidence: PopularityConfidence;
  reason: string;
}

const SYSTEM_PROMPT = `あなたはデュエル・マスターズ(トレーディングカードゲーム)の情報に詳しいリサーチアシスタントです。

ユーザーから、カード名があいまいで複数の候補カードのどれを指しているか公式データベースだけでは特定できない質問が来ます。Web検索ツールを使って、候補カードそれぞれが現在のデュエル・マスターズの対戦環境・話題(大会結果、デッキレシピ、SNSでの言及、まとめサイト等)でどれだけ使用・言及されているかを調査してください。

調査の結果、候補のうち1つが他と比較して圧倒的に(誰が見ても明らかなレベルで)多く使用・言及されている場合のみ、それを解決結果としてください。差が僅かだったり、情報が少なく判断が難しい場合は、無理に決めず確定しないでください。誤って別のカードとして確定させることは、ユーザーに誤った裁定を伝えることに直結するため、確信が持てない場合は必ずnullを返してください。

必ず次のJSON形式のみで回答してください。前置きや説明文、Markdownのコードブロックは一切含めないでください。

{
  "resolved_card_name": "確定したカードの正式名称(候補の文字列と完全一致させること)。確定できない場合はnull",
  "confidence": "very_high" または "moderate" または "low" または "unclear" のいずれか(圧倒的に優勢と言える場合のみvery_high)",
  "reason": "判断根拠の要約(100文字程度)"
}`;

function buildUserMessage(queried: string, candidates: string[]): string {
  const candidateList = candidates.map((name) => `《${name}》`).join(" / ");
  return `あいまいなカード名: 「${queried}」\n候補: ${candidateList}\n\nWeb検索で調査し、指示されたJSON形式のみで回答してください。`;
}

function parseResolution(text: string): PopularityResolution | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof json.confidence !== "string") return null;
    return {
      resolvedCardName: typeof json.resolved_card_name === "string" ? json.resolved_card_name : null,
      confidence: json.confidence as PopularityConfidence,
      reason: typeof json.reason === "string" ? json.reason : "",
    };
  } catch {
    return null;
  }
}

/**
 * カード名が複数候補であいまいな場合に、Claude APIのWeb検索ツールで
 * 現在の対戦環境における話題度を調査し、候補の中の1つが圧倒的に優勢と
 * 判断できた場合のみそのカード名を返す。判断できない場合はnullを返し、
 * 呼び出し側は従来通りユーザーへの候補確認にフォールバックする。
 */
export async function resolvePopularCardName(
  queried: string,
  candidates: string[],
): Promise<string | null> {
  if (candidates.length < 2) return null;

  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(queried, candidates) }],
    });

    const textBlock = [...response.content].reverse().find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    const resolution = parseResolution(textBlock.text);
    if (!resolution || resolution.confidence !== "very_high" || !resolution.resolvedCardName) {
      return null;
    }
    if (!candidates.includes(resolution.resolvedCardName)) return null;

    logger.info("ambiguous_card_resolved_by_popularity", {
      queried,
      candidates,
      resolved: resolution.resolvedCardName,
      reason: resolution.reason.slice(0, REASON_LOG_MAX_LENGTH),
    });
    return resolution.resolvedCardName;
  } catch (error) {
    logger.error("popularity_resolution_failed", {
      queried,
      candidates,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
