import { produceRuling } from "./produceRuling";
import { markRunning, markDone, markFailed, markNotified, pruneOldJobs } from "./rulingJobRepository";
import { getToken, deleteToken } from "../push/pushTokenRepository";
import { sendPushNotification } from "../push/fcm";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const PUSH_BODY_MAX_LENGTH = 120;

let runningCount = 0;

export function getRunningJobCount(): number {
  return runningCount;
}

export function canAcceptNewJob(): boolean {
  return runningCount < env.RULING_JOB_MAX_CONCURRENCY;
}

/**
 * 裁定生成をバックグラウンドで実行する(呼び出し元はawaitせず即座に制御を返す想定)。
 * produceRulingは例外を投げず{status, result}を返す設計のため、.catchは
 * DBエラー等の予期しない例外専用のセーフティネットとして扱う。
 */
export function runRulingJobInBackground(
  jobId: string,
  question: string,
  deviceId: string | null,
  threadId: string | null,
): void {
  runningCount++;
  markRunning(jobId);

  produceRuling(question)
    .then(async (outcome) => {
      markDone(jobId, outcome.status, outcome.result);

      if (!deviceId) return;
      const token = getToken(deviceId);
      if (!token) return;

      const pushResult = await sendPushNotification({
        token,
        title: "裁定の準備ができました",
        body: outcome.result.conclusion.slice(0, PUSH_BODY_MAX_LENGTH),
        data: { jobId, type: "ruling_result", ...(threadId ? { threadId } : {}) },
      });
      markNotified(jobId);
      if (pushResult.shouldRemoveToken) {
        deleteToken(deviceId);
      }
    })
    .catch((error) => {
      markFailed(jobId, error instanceof Error ? error.message : String(error));
      logger.error("ruling_job_failed", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      runningCount--;
      pruneOldJobs(env.RULING_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    });
}
