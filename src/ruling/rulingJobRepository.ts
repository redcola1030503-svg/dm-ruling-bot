import { db } from "../config/db";
import type { RulingResult } from "./types";

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
};

export function createJob(
  id: string,
  question: string,
  deviceId: string | null,
  threadId: string | null,
): void {
  db.prepare(
    `INSERT INTO ruling_job (id, device_id, question, status, thread_id, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).run(id, deviceId, question, threadId, Date.now());
}

export function markRunning(id: string): void {
  db.prepare("UPDATE ruling_job SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), id);
}

export function markDone(id: string, outcomeStatus: string, result: RulingResult): void {
  db.prepare(
    `UPDATE ruling_job SET status = 'done', outcome_status = ?, result_json = ?, finished_at = ? WHERE id = ?`,
  ).run(outcomeStatus, JSON.stringify(result), Date.now(), id);
}

export function markFailed(id: string, error: string): void {
  db.prepare("UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
    error,
    Date.now(),
    id,
  );
}

export function markNotified(id: string): void {
  db.prepare("UPDATE ruling_job SET notified_at = ? WHERE id = ?").run(Date.now(), id);
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

// 無料枠(月n問)の判定用。UTC暦月の月初からnowMsまでの件数を数える。
// JSTとの数時間のズレは無料枠判定の精度として許容する(意図的な簡略化)。
export function countJobsThisMonth(deviceId: string, nowMs: number): number {
  const now = new Date(nowMs);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0);
  const row = db
    .prepare("SELECT COUNT(*) as count FROM ruling_job WHERE device_id = ? AND created_at >= ?")
    .get(deviceId, monthStart) as { count: number };
  return row.count;
}
