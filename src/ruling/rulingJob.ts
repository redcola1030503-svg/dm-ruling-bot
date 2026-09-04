import { randomUUID } from "node:crypto";
import { produceRuling } from "./produceRuling";
import { markRunning, markNotified, finalizeRulingJob, pruneOldJobs, renewHeartbeat } from "./rulingJobRepository";
import { getToken, deleteToken } from "../push/pushTokenRepository";
import { sendPushNotification } from "../push/fcm";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const PUSH_BODY_MAX_LENGTH = 120;

// プロセスごとに一意なID。ruling_job.worker_idへ記録し、DB上で「このジョブを
// 現在担当しているプロセスがまだ生きているか」をheartbeat_atの鮮度で判定できる
// ようにする(T012 Review 8: デプロイによる新旧プロセスの入れ替わりをまたいだ
// 生存確認には、プロセス内メモリのrunningJobIdsだけでは不十分だったため)。
const WORKER_ID = randomUUID();

let runningCount = 0;

// このプロセスが現在バックグラウンドで処理中のjobId集合。定期的なheartbeat
// 更新の対象を絞るためだけに使う(孤立ジョブ回収自体の判定はDB側のheartbeat_at
// で行うため、この集合は回収ロジックからは参照されない)。
const runningJobIds = new Set<string>();

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

function renewHeartbeatsForRunningJobs(): void {
  for (const jobId of runningJobIds) {
    try {
      renewHeartbeat(jobId, WORKER_ID);
    } catch (error) {
      logger.error("ruling_job_heartbeat_renewal_failed", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

let heartbeatIntervalHandle: ReturnType<typeof setInterval> | null = null;

export function startHeartbeatRenewal(): void {
  if (heartbeatIntervalHandle) return;
  heartbeatIntervalHandle = setInterval(renewHeartbeatsForRunningJobs, HEARTBEAT_INTERVAL_MS);
  heartbeatIntervalHandle.unref();
}

export function stopHeartbeatRenewal(): void {
  if (heartbeatIntervalHandle) {
    clearInterval(heartbeatIntervalHandle);
    heartbeatIntervalHandle = null;
  }
}

export function getRunningJobCount(): number {
  return runningCount;
}

export function canAcceptNewJob(): boolean {
  return runningCount < env.RULING_JOB_MAX_CONCURRENCY;
}

async function notifyIfPossible(
  jobId: string,
  deviceId: string | null,
  threadId: string | null,
  conclusion: string,
): Promise<void> {
  if (!deviceId) return;
  const token = getToken(deviceId);
  if (!token) return;

  const pushResult = await sendPushNotification({
    token,
    title: "裁定の準備ができました",
    body: conclusion.slice(0, PUSH_BODY_MAX_LENGTH),
    data: { jobId, type: "ruling_result", ...(threadId ? { threadId } : {}) },
  });
  markNotified(jobId);
  if (pushResult.shouldRemoveToken) {
    deleteToken(deviceId);
  }
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
  try {
    runningCount++;
    runningJobIds.add(jobId);
    markRunning(jobId, WORKER_ID);
  } catch (error) {
    // markRunning自体が同期的に例外を投げた場合(DB例外等)、以降のPromise
    // チェーンに一切入らないため、この場でジョブを失敗確定させる(T010/T012
    // Codexレビュー指摘: 従来この経路は確定処理の対象外で、消費済みの無料枠・
    // 作成済みジョブ行が取り残されていた)。
    runningJobIds.delete(jobId);
    runningCount = Math.max(runningCount - 1, 0);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("ruling_job_start_failed", { jobId, error: message });
    try {
      finalizeRulingJob(jobId, { outcome: "failed", error: message });
    } catch (finalizeError) {
      logger.error("ruling_job_finalize_after_start_failure_failed", {
        jobId,
        error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
      });
    }
    return;
  }

  produceRuling(question)
    .then(async (outcome) => {
      const finalized = finalizeRulingJob(jobId, {
        outcome: "done",
        outcomeStatus: outcome.status,
        result: outcome.result,
      });
      // 既に他の経路(孤立ジョブ回収・スレッド削除等)で確定済みの場合は、
      // 通知を送らない(二重通知防止。T010設計「実際にこの呼び出しが確定処理を
      // 行ったか」参照)。
      if (!finalized.won) return;

      // 通知(プッシュ送信)はジョブの確定処理とは独立させる。ここで例外が
      // 起きても、裁定自体は既にfinalizeRulingJobで確定済み(結果は
      // GET /api/ruling/jobs/:jobIdから取得可能)なので、下のcatchで
      // finalizeRulingJob(failed)を再度呼んで確定を上書きしたり、無関係な
      // ruling_job_failedログを残したりしない(Codexレビュー指摘)。
      try {
        await notifyIfPossible(jobId, deviceId, threadId, outcome.result.conclusion);
      } catch (notifyError) {
        logger.error("ruling_job_notification_failed", {
          jobId,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("ruling_job_failed", { jobId, error: message });
      // finalizeRulingJob自体が例外を投げた場合(DB障害等)、このハンドラより
      // 後段にcatchが無いため未処理のPromise rejectionになりプロセス終了へ
      // 波及しかねない(Codexレビュー指摘)。ここで確定できなくても、ジョブは
      // pending/runningのまま残り、T012(A)の孤立ジョブ回収が後から拾って
      // 確定させる(.finally()でrunningJobIdsから除外されheartbeatが止まるため、
      // 回収対象から漏れない)。
      try {
        finalizeRulingJob(jobId, { outcome: "failed", error: message });
      } catch (finalizeError) {
        logger.error("ruling_job_finalize_failed", {
          jobId,
          error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
        });
      }
    })
    .finally(() => {
      runningCount = Math.max(runningCount - 1, 0);
      runningJobIds.delete(jobId);
      try {
        pruneOldJobs(env.RULING_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      } catch (pruneError) {
        logger.error("ruling_job_prune_failed", {
          error: pruneError instanceof Error ? pruneError.message : String(pruneError),
        });
      }
    });
}
