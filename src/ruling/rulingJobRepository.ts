import type { SQLInputValue } from "node:sqlite";
import { db } from "../config/db";
import type { RulingResult } from "./types";
import { decrementMonthlyUsage } from "../billing/deviceMonthlyUsageRepository";
import { logger } from "../utils/logger";

export type RulingJobStatus = "pending" | "running" | "done" | "failed";

export type RulingJobRow = {
  id: string;
  device_id: string | null;
  question: string;
  status: RulingJobStatus;
  outcome_status: string | null;
  result_json: string | null;
  error: string | null;
  notified_at: number | null;
  thread_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  usage_month_key: string | null;
  refunded_at: number | null;
  worker_id: string | null;
  heartbeat_at: number | null;
};

export function createJob(
  id: string,
  question: string,
  deviceId: string | null,
  threadId: string | null,
  // T010: このジョブが消費した無料枠のmonthKey。購読中・無料枠を消費しない
  // 場合はnull(finalizeRulingJobの返金判定はこの値の有無で行う)。
  usageMonthKey: string | null,
): void {
  db.prepare(
    `INSERT INTO ruling_job (id, device_id, question, status, thread_id, usage_month_key, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, deviceId, question, threadId, usageMonthKey, Date.now());
}

// workerIdは呼び出し元プロセスを識別するID(rulingJob.tsのWORKER_ID)。
// heartbeat_atも同時に打刻することで、開始直後から孤立ジョブ回収の対象外にする。
export function markRunning(id: string, workerId: string): void {
  const now = Date.now();
  db.prepare("UPDATE ruling_job SET status = 'running', started_at = ?, worker_id = ?, heartbeat_at = ? WHERE id = ?").run(
    now,
    workerId,
    now,
    id,
  );
}

// T012 Review 8: このプロセスが現在も処理中であることをDBへ定期的に伝える生存確認。
// workerIdが一致し、かつまだ'running'のジョブのみを更新する(既に孤立ジョブ回収や
// 通常完了で確定済みのジョブへは影響しない)。
export function renewHeartbeat(id: string, workerId: string): void {
  db.prepare(
    "UPDATE ruling_job SET heartbeat_at = ? WHERE id = ? AND worker_id = ? AND status = 'running'",
  ).run(Date.now(), id, workerId);
}

export function markNotified(id: string): void {
  db.prepare("UPDATE ruling_job SET notified_at = ? WHERE id = ?").run(Date.now(), id);
}

// T010: "ok"(正常に裁定を生成できた)以外は無料枠の返金対象とする
// (evidence_error/llm_error/needs_clarification、およびproduceRuling自体が
// 例外を投げて解決に至らなかった"failed"の全て)。
function isRefundableOutcome(params: FinalizeRulingJobParams): boolean {
  return !(params.outcome === "done" && params.outcomeStatus === "ok");
}

export type FinalizeRulingJobParams =
  | { outcome: "done"; outcomeStatus: string; result: RulingResult }
  | { outcome: "failed"; error: string };

export type FinalizeRulingJobResult =
  // won=true: このジョブの確定処理を実際に行った(呼び出し元は通知等の後続処理を実行してよい)。
  | { won: true; refunded: boolean; deviceId: string | null }
  // won=false: 既に他の経路(通常完了/孤立ジョブ回収/スレッド削除等)で確定済みだった、
  // またはジョブ行自体が既に存在しない(スレッド削除で物理削除された等)。
  | { won: false };

// UPDATE(状態遷移)自体を1件も他へ委ねず、この関数内で発行したSQL・パラメータの
// 条件を満たした行だけを確定・返金する共通処理。呼び出し元がUPDATE文に埋め込む
// 条件(status IN (...)、あるいはorphan回収用のheartbeat/created_at鮮度条件)が、
// 「確定してよい」ことの唯一の判定根拠になる(SELECT時点の判定だけに頼ると、
// SELECT後にUPDATEするまでの間に状態が変わるTOCTOU競合を許してしまうため)。
function commitFinalize(
  id: string,
  updateSql: string,
  updateParams: SQLInputValue[],
  isRefundable: boolean,
): FinalizeRulingJobResult {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    const existing = db
      .prepare("SELECT device_id, usage_month_key FROM ruling_job WHERE id = ?")
      .get(id) as { device_id: string | null; usage_month_key: string | null } | undefined;

    const changes = db.prepare(updateSql).run(...updateParams).changes;

    if (!existing || changes === 0) {
      db.exec("COMMIT");
      return { won: false };
    }

    let refunded = false;
    if (existing.usage_month_key && existing.device_id && isRefundable) {
      decrementMonthlyUsage(existing.device_id, existing.usage_month_key);
      db.prepare("UPDATE ruling_job SET refunded_at = ? WHERE id = ?").run(now, id);
      refunded = true;
    }

    db.exec("COMMIT");
    if (refunded) {
      logger.info("ruling_job_quota_refunded", { jobId: id, deviceId: existing.device_id });
    }
    return { won: true, refunded, deviceId: existing.device_id };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * ジョブの確定(done/failed)と、条件を満たす場合の無料枠返金を1トランザクションで
 * 行う。原子的な状態遷移(status IN ('pending','running')条件でのUPDATE、更新件数で
 * 競合の勝ち負けを判定)により、同じジョブに対して複数の経路(通常完了・定期的な
 * 孤立ジョブ回収・スレッド削除)から同時に呼ばれても、確定処理・返金のいずれも
 * 二重に実行されない(Codexレビュー指摘、T010/T012設計を参照)。
 */
export function finalizeRulingJob(id: string, params: FinalizeRulingJobParams): FinalizeRulingJobResult {
  const now = Date.now();
  const updateSql =
    params.outcome === "done"
      ? `UPDATE ruling_job SET status = 'done', outcome_status = ?, result_json = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`
      : `UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`;
  const updateParams =
    params.outcome === "done"
      ? [params.outcomeStatus, JSON.stringify(params.result), now, id]
      : [params.error, now, id];
  return commitFinalize(id, updateSql, updateParams, isRefundableOutcome(params));
}

/**
 * T012 Review 8フォローアップ: 孤立ジョブ回収専用の確定処理。findStaleJobsでの
 * SELECT時点の判定だけに頼らず、UPDATE文自体に鮮度条件(pendingならcreated_at、
 * runningならheartbeat_atまたは〈heartbeatが無い旧デプロイ由来の行向けの〉
 * created_at)を埋め込むことで、SELECTからUPDATEまでの間に別プロセスが
 * heartbeatを更新して正常化したジョブを誤って確定してしまうTOCTOU競合を防ぐ。
 */
export function finalizeOrphanedRulingJob(
  id: string,
  guard:
    | { status: "pending"; createdBefore: number }
    | { status: "running"; heartbeatBefore: number; legacyCreatedBefore: number },
  errorMessage: string,
): FinalizeRulingJobResult {
  const now = Date.now();
  const updateSql =
    guard.status === "pending"
      ? `UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status = 'pending' AND created_at < ?`
      : `UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status = 'running'
           AND (
             (heartbeat_at IS NOT NULL AND heartbeat_at < ?)
             OR (heartbeat_at IS NULL AND created_at < ?)
           )`;
  const updateParams =
    guard.status === "pending"
      ? [errorMessage, now, id, guard.createdBefore]
      : [errorMessage, now, id, guard.heartbeatBefore, guard.legacyCreatedBefore];
  // 孤立ジョブ回収は常にoutcome="failed"相当(isRefundableOutcomeは"done"かつ"ok"の
  // 場合のみfalseを返すため、常にtrueで固定してよい)。
  return commitFinalize(id, updateSql, updateParams, true);
}

export function getJob(id: string): RulingJobRow | null {
  const row = db.prepare("SELECT * FROM ruling_job WHERE id = ?").get(id) as RulingJobRow | undefined;
  return row ?? null;
}

export function getJobsByThread(threadId: string): RulingJobRow[] {
  return db
    .prepare("SELECT * FROM ruling_job WHERE thread_id = ? ORDER BY created_at ASC")
    .all(threadId) as RulingJobRow[];
}

// ruling_job.thread_idにFK制約(ON DELETE CASCADE)が無いため、
// スレッド削除時はこの関数で明示的にジョブ側も削除する必要がある。
export function deleteJobsByThread(threadId: string): void {
  db.prepare("DELETE FROM ruling_job WHERE thread_id = ?").run(threadId);
}

// 完了/失敗から一定期間経過したジョブを削除する(ジョブ作成のたびに機会的に実行)。
// スレッドに紐づくジョブ(thread_id IS NOT NULL)はスレッド履歴として無期限保持し、
// スレッド化されていない孤立ジョブ(旧クライアント等でdeviceId未送信の場合)のみ対象とする。
export function pruneOldJobs(retentionMs: number): void {
  const threshold = Date.now() - retentionMs;
  db.prepare(
    `DELETE FROM ruling_job
     WHERE status IN ('done', 'failed')
       AND finished_at IS NOT NULL
       AND finished_at < ?
       AND thread_id IS NULL`,
  ).run(threshold);
}

// 「ジャッジID: 」(半角スペースあり)を前提にしていたが、実際の本番データには
// スペース無し(「ジャッジID:xxxx」形式)の行も存在し、当初のパターンでは
// マッチせず移行漏れが発生していた(2026-09-04、本番DBの読み取り専用クエリで
// 確認・判明。実際のジャッジIDはここには記載しない)。コロン直後のスペースは無くても許容する。
const LEGACY_CORRECTION_TITLE_PATTERN = /過去の訂正事例\(ジャッジID: ?[^)]*\)/g;
const CORRECTION_TITLE_WITHOUT_JUDGE_ID = "過去の訂正事例(公認ジャッジによる記録)";

/**
 * T008: retrieveEvidence.tsの旧title形式(`過去の訂正事例(ジャッジID: xxx)`)が
 * 過去にresult_jsonへ保存されたまま残っている場合、judgeIdを含まない表記へ置き換える。
 * result_jsonはJSON文字列だが、置換文字列がJSON上特別な意味を持つ文字(引用符・
 * バックスラッシュ等)を含まないため、パースせず文字列置換のみで安全に書き換えられる。
 * スレッド付きジョブは無期限保持されるため(pruneOldJobs参照)、この移行が無いと
 * 旧titleが残り続ける。1回限りの本番マイグレーション用。
 */
export function migrateLegacyCorrectionTitlesInResultJson(): number {
  const rows = db
    .prepare("SELECT id, result_json FROM ruling_job WHERE result_json LIKE '%ジャッジID:%'")
    .all() as { id: string; result_json: string | null }[];

  let migrated = 0;
  for (const row of rows) {
    if (!row.result_json) continue;
    const updated = row.result_json.replace(LEGACY_CORRECTION_TITLE_PATTERN, CORRECTION_TITLE_WITHOUT_JUDGE_ID);
    if (updated !== row.result_json) {
      db.prepare("UPDATE ruling_job SET result_json = ? WHERE id = ?").run(updated, row.id);
      migrated++;
    }
  }
  return migrated;
}
