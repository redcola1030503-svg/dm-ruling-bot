import type { RulingJobRow } from "./rulingJobRepository";
import type { RulingResult } from "./types";

const FOLLOW_UP_HISTORY_LOOKBACK = 6;

/**
 * スレッド内の過去のやり取りを、LINE Bot側のbuildContextualQuestion(src/routes/lineWebhook.ts)
 * と同じ発想でプロンプト文字列に連結する。DBのquestionカラムには常に生の質問のみ保存し、
 * この合成結果はLLMへの入力としてのみ使う。
 */
export function buildFollowUpQuestion(priorJobs: RulingJobRow[], latestQuestion: string): string {
  const doneJobs = priorJobs.filter((job) => job.status === "done" && job.result_json);
  if (doneJobs.length === 0) return latestQuestion;

  const recentJobs = doneJobs.slice(-FOLLOW_UP_HISTORY_LOOKBACK);
  const historyLines: string[] = [];
  for (const job of recentJobs) {
    let conclusion: string;
    try {
      conclusion = (JSON.parse(job.result_json!) as RulingResult).conclusion;
    } catch {
      continue;
    }
    historyLines.push(`ユーザー: ${job.question}\nBot: ${conclusion}`);
  }

  if (historyLines.length === 0) return latestQuestion;

  return `これまでの会話:\n${historyLines.join("\n")}\n\n新しい質問:\n${latestQuestion}`;
}
