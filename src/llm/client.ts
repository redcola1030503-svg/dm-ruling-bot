import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is not configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.LLM_API_KEY });
  }
  return client;
}

// 裁定生成以外(あいまいカード名のWeb検索解決など)でも同じクライアントを
// 使い回すためのエクスポート。
export function getAnthropicClient(): Anthropic {
  return getClient();
}

const MODEL = "claude-sonnet-5";

export async function completeJson(params: {
  system: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 2000,
    system: params.system,
    messages: [{ role: "user", content: params.userMessage }],
    thinking: { type: "disabled" },
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error("LLM response was truncated (max_tokens reached)");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("LLM response did not contain a text block");
  }
  return textBlock.text;
}
