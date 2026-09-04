import { db } from "../config/db";
import { finalizeOrphanedRulingJob } from "./rulingJobRepository";
import { logger } from "../utils/logger";

// pending: createJob直後にrunRulingJobInBackgroundが同一tickでmarkRunningを呼ぶため、
// 通常はpendingのまま長時間残ることは無い。プロセスがその一瞬でクラッシュした場合等の
// 極めて稀なケースのみを想定した長めの閾値。
//
// running(heartbeatが無い場合、下記RUNNING_JOB_LEASE_TIMEOUT_MSも参照): この閾値を
// この設計を初めて導入したデプロイの直後にも流用する(T012 Review 8フォローアップ指摘:
// 導入直後は旧プロセスが担当していたrunning行のheartbeat_atがNULLのままであり、経過
// 時間を全く考慮せず即座に孤立扱いすると、旧プロセスが正常に処理し続けていたジョブまで
// 誤って失敗・返金確定してしまう。従来(heartbeat導入前)のcreated_atベースの閾値と
// 同じ値を流用することで、少なくとも導入前と同等以上の猶予を与える)。
const PENDING_ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

// running(heartbeatがある場合): ruling_job.heartbeat_atを「このジョブを現在担当している
// プロセスの生存確認」として扱う(T012 Review 8指摘: プロセス内メモリのrunningJobIdsだけ
// では、デプロイによる新旧プロセスの入れ替わりをまたいだ生存確認ができず、新プロセスが
// 旧プロセスの正常処理中のジョブを誤って孤立扱い・返金確定してしまう恐れがあった)。担当
// プロセスがこのプロセスか旧プロセスかを問わず、heartbeat_atがこの猶予期間を超えて
// 更新されていない場合のみ「担当プロセスが死んでいる」とみなして回収する。rulingJob.tsの
// HEARTBEAT_INTERVAL_MS(1分)より十分大きく、通常の処理時間(LLM呼び出しタイムアウト
// 3分×maxRetries:0)より十分大きい値にする。
const RUNNING_JOB_LEASE_TIMEOUT_MS = 5 * 60 * 1000;

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const ORPHANED_JOB_ERROR_MESSAGE =
  "サーバーの再起動または異常終了により、処理が中断されました。お手数ですが再度お試しください。";

type StaleJobRow = { id: string; status: "pending" | "running"; created_at: number };

function findStaleJobs(pendingThreshold: number, leaseThreshold: number, legacyThreshold: number): StaleJobRow[] {
  return db
    .prepare(
      `SELECT id, status, created_at FROM ruling_job
       WHERE (status = 'pending' AND created_at < ?)
          OR (status = 'running' AND heartbeat_at IS NOT NULL AND heartbeat_at < ?)
          OR (status = 'running' AND heartbeat_at IS NULL AND created_at < ?)`,
    )
    .all(pendingThreshold, leaseThreshold, legacyThreshold) as StaleJobRow[];
}

/**
 * pendingのまま長時間経過したジョブ、およびrunningのままheartbeat_atが更新されなく
 * なった(≒担当プロセスが死んだと判断できる)ジョブを走査し、`failed`+返金確定する。
 * running判定の生存確認はDB(heartbeat_at)で行うため、単一プロセス構成に限らず、
 * デプロイによるプロセスの入れ替わりをまたいでも「まだ生きている正常な処理」を
 * 誤って回収しない。
 *
 * 候補行の抽出(findStaleJobs)はSELECTのみで判定の根拠にはせず、実際の確定は
 * finalizeOrphanedRulingJobのUPDATE自体に同じ鮮度条件を埋め込んで再検証する
 * (Codexレビュー指摘: SELECTからUPDATEまでの間に別プロセスがheartbeatを更新して
 * 正常化したジョブを、鮮度を再確認せずに確定してしまうTOCTOU競合を防ぐため)。
 *
 * 走査全体・ジョブ単位の両方を例外から守る(Codexレビュー指摘: 1件のDB
 * 不整合や一時的な障害で確定処理が例外を投げると、`setInterval`コールバック内の
 * 未捕捉例外としてプロセス全体が落ちかねない。また1件の失敗で後続ジョブの回収が
 * 中断されるのも避けたい)。
 */
export function sweepOrphanedRulingJobs(): void {
  const now = Date.now();
  const pendingThreshold = now - PENDING_ORPHAN_THRESHOLD_MS;
  const leaseThreshold = now - RUNNING_JOB_LEASE_TIMEOUT_MS;
  // running かつ heartbeat_at IS NULL(heartbeat導入前の行)向けの猶予期間。
  // pendingと同じ閾値を流用する(上記PENDING_ORPHAN_THRESHOLD_MSのコメント参照)。
  const legacyThreshold = pendingThreshold;

  let staleJobs: StaleJobRow[];
  try {
    staleJobs = findStaleJobs(pendingThreshold, leaseThreshold, legacyThreshold);
  } catch (error) {
    logger.error("orphaned_ruling_job_sweep_query_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const job of staleJobs) {
    try {
      const guard =
        job.status === "pending"
          ? ({ status: "pending", createdBefore: pendingThreshold } as const)
          : ({ status: "running", heartbeatBefore: leaseThreshold, legacyCreatedBefore: legacyThreshold } as const);
      const result = finalizeOrphanedRulingJob(job.id, guard, ORPHANED_JOB_ERROR_MESSAGE);
      if (result.won) {
        logger.warn("orphaned_ruling_job_recovered", {
          jobId: job.id,
          ageMs: now - job.created_at,
          refunded: result.refunded,
        });
      }
    } catch (error) {
      logger.error("orphaned_ruling_job_finalize_failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startOrphanedJobSweep(): void {
  sweepOrphanedRulingJobs();
  if (intervalHandle) return;
  intervalHandle = setInterval(sweepOrphanedRulingJobs, SWEEP_INTERVAL_MS);
  intervalHandle.unref();
}

export function stopOrphanedJobSweep(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
