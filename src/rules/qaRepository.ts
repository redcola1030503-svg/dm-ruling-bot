import { db } from "../config/db";
import type { QaDetail } from "./types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

type QaRow = {
  id: string;
  url: string;
  question: string;
  answer: string;
  updated_at: number;
};

export function getCachedQa(id: string): QaDetail | null {
  const row = db.prepare("SELECT * FROM qa_cache WHERE id = ?").get(id) as QaRow | undefined;
  if (!row) return null;
  if (Date.now() - row.updated_at > CACHE_TTL_MS) return null;
  return { id: row.id, url: row.url, question: row.question, answer: row.answer };
}

export function saveQaToCache(qa: QaDetail): void {
  db.prepare(
    `INSERT INTO qa_cache (id, url, question, answer, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, question=excluded.question, answer=excluded.answer, updated_at=excluded.updated_at`,
  ).run(qa.id, qa.url, qa.question, qa.answer, Date.now());
}
