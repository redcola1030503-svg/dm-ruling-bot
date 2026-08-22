import { db } from "../config/db";

export type RulingThreadRow = {
  id: string;
  device_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

const TITLE_MAX_LENGTH = 40;

export function deriveThreadTitle(question: string): string {
  const trimmed = question.trim();
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX_LENGTH)}…`;
}

export function createThread(id: string, deviceId: string, title: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ruling_thread (id, device_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, deviceId, title, now, now);
}

export function getThread(id: string): RulingThreadRow | null {
  const row = db.prepare("SELECT * FROM ruling_thread WHERE id = ?").get(id) as
    | RulingThreadRow
    | undefined;
  return row ?? null;
}

export function touchThread(id: string): void {
  db.prepare("UPDATE ruling_thread SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

export function listThreadsByDevice(deviceId: string, limit = 100): RulingThreadRow[] {
  return db
    .prepare("SELECT * FROM ruling_thread WHERE device_id = ? ORDER BY updated_at DESC LIMIT ?")
    .all(deviceId, limit) as RulingThreadRow[];
}

export function deleteThread(id: string): void {
  db.prepare("DELETE FROM ruling_thread WHERE id = ?").run(id);
}
