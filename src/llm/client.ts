import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { env } from "../config/env";
import { logger } from "../utils/logger";

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
// T012(A): 孤立ジョブ回収の定期走査が、単に処理に時間がかかっているだけの
// 正常なジョブを誤って打ち切らないよう、LLM呼び出し自体にも上限を設ける
// (Anthropic SDKの既定タイムアウトに依存せず明示する)。単体呼び出しの上限で
// あり、質問解析+裁定生成の合計時間はこれより長くなりうる点に注意(孤立/
// 正常実行中の判定自体はruling_job.heartbeat_atの鮮度で行う、T012 Review 8
// 対応。詳細はsrc/ruling/orphanedJobSweep.ts参照)。
// Anthropic SDKは既定でmaxRetries=2(タイムアウト自体も再試行対象)のため、
// timeoutを指定するだけでは「1回の試行あたりの上限」にしかならず、実際の
// 呼び出し全体は最大で約3倍(最大約9分)かかりうる(Codexレビュー指摘、
// 2026-09-04)。ここでは再試行そのものを無効化し、timeoutを呼び出し全体の
// 厳密な上限にする(再試行が無くなる分の一時的なネットワーク不調による失敗は、
// T010の返金対象〈llm_error〉としてユーザーへ返金される想定のため許容する)。
const LLM_CALL_TIMEOUT_MS = 3 * 60 * 1000;
const LLM_CALL_MAX_RETRIES = 0;

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

/**
 * コスト試算(アクティブユーザー数・質問数と組み合わせた概算)のため、
 * LLM呼び出し1回ごとのトークン使用量をログに残す。labelで呼び出し元
 * (analyze_question/generate_ruling)を区別できるようにする。
 */
function logUsage(label: string, message: Message): void {
  logger.info("llm_usage", {
    label,
    model: MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
  });
}

export async function completeJson(params: {
  system: string;
  userMessage: string;
  maxTokens?: number;
  label: string;
}): Promise<string> {
  const response = await getClient().messages.create(
    {
      model: MODEL,
      max_tokens: params.maxTokens ?? 2000,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: params.userMessage }],
      thinking: { type: "disabled" },
    },
    { timeout: LLM_CALL_TIMEOUT_MS, maxRetries: LLM_CALL_MAX_RETRIES },
  );

  logUsage(params.label, response);
  return extractText(response);
}
