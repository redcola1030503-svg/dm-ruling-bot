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
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export function createJob(id: string, question: string, deviceId: string | null): void {
  db.prepare(
    `INSERT INTO ruling_job (id, device_id, question, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`,
  ).run(id, deviceId, question, Date.now());
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

// 完了/失敗から一定期間経過したジョブを削除する(ジョブ作成のたびに機会的に実行)。
export function pruneOldJobs(retentionMs: number): void {
  const threshold = Date.now() - retentionMs;
  db.prepare(
    "DELETE FROM ruling_job WHERE status IN ('done', 'failed') AND finished_at IS NOT NULL AND finished_at < ?",
  ).run(threshold);
}
