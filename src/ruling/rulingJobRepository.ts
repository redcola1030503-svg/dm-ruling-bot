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

// 「ジャッジID: 」(半角スペースあり)を前提にしていたが、実際の本番データには
// スペース無し(「ジャッジID:01074」形式)の行も存在し、当初のパターンでは
// マッチせず移行漏れが発生していた(2026-09-04、本番DBの読み取り専用クエリで
// 確認・判明)。コロン直後のスペースは無くても許容する。
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
