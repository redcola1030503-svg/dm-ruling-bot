import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
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

const MODEL = "claude-sonnet-5";
const BATCH_POLL_INTERVAL_MS = 10_000;
const BATCH_CUSTOM_ID = "req";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractText(message: Message): string {
  if (message.stop_reason === "max_tokens") {
    throw new Error("LLM response was truncated (max_tokens reached)");
  }
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("LLM response did not contain a text block");
  }
  return textBlock.text;
}

export async function completeJson(params: {
  system: string;
  userMessage: string;
  maxTokens?: number;
  useBatchApi?: boolean;
}): Promise<string> {
  if (params.useBatchApi) {
    return completeJsonViaBatch(params);
  }

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 2000,
    system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: params.userMessage }],
    thinking: { type: "disabled" },
  });

  return extractText(response);
}

/**
 * Message Batches API(入出力とも50%割引)経由でリクエストを1件だけのバッチとして
 * 送信し、完了(processing_status: "ended")までポーリングしてから結果を取り出す。
 * 通常「1時間以内」で完了するが保証はなく最大24時間かかりうるため、非同期ジョブ
 * (rulingJob.ts、既にPush通知で完了を伝える設計)経由の呼び出し専用とする。
 */
async function completeJsonViaBatch(params: {
  system: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<string> {
  const anthropic = getClient();
  const batch = await anthropic.messages.batches.create({
    requests: [
      {
        custom_id: BATCH_CUSTOM_ID,
        params: {
          model: MODEL,
          max_tokens: params.maxTokens ?? 2000,
          system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: params.userMessage }],
          thinking: { type: "disabled" },
        },
      },
    ],
  });

  let current = batch;
  while (current.processing_status !== "ended") {
    await sleep(BATCH_POLL_INTERVAL_MS);
    current = await anthropic.messages.batches.retrieve(batch.id);
  }

  for await (const item of await anthropic.messages.batches.results(batch.id)) {
    if (item.custom_id !== BATCH_CUSTOM_ID) continue;
    if (item.result.type !== "succeeded") {
      throw new Error(`LLM batch request did not succeed (result type: ${item.result.type})`);
    }
    return extractText(item.result.message);
  }
  throw new Error("LLM batch result not found for custom_id");
}
