import { createHash } from "node:crypto";
import { db } from "../config/db";
import { bufferToFloat32Array, float32ArrayToBuffer } from "../embeddings/embeddingUtils";
import type { QaDetail } from "./types";

type QaIndexRow = {
  id: string;
  url: string;
  question: string;
  answer: string;
  content_hash: string;
};

type QaIndexRowWithEmbedding = QaIndexRow & {
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_text_hash: string | null;
};

export type QaIndexEntry = QaDetail & { embeddingScore: number };

/** embedding生成スクリプトが差分判定に使う、DB行そのものを表す型。 */
export type QaIndexChunkRow = QaDetail & {
  contentHash: string;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  embeddingTextHash: string | null;
};

function computeQaContentHash(qa: QaDetail): string {
  return createHash("sha256").update(`${qa.id} ${qa.question} ${qa.answer}`).digest("hex");
}

/**
 * 意味検索用のQ&A全件コーパス(qa_index)への1件登録。qa_cache(24時間TTLの
 * 短命キャッシュ、通常のキーワード検索経路が使う)とは別のテーブルで、
 * embedding生成のための永続的な全件インデックスとして扱う。
 */
export function upsertQaIndexEntry(qa: QaDetail): void {
  const contentHash = computeQaContentHash(qa);
  db.prepare(
    `INSERT INTO qa_index (id, url, question, answer, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, question=excluded.question, answer=excluded.answer,
       content_hash=excluded.content_hash, updated_at=excluded.updated_at`,
  ).run(qa.id, qa.url, qa.question, qa.answer, contentHash, Date.now());
}

export function getQaIndexUpdatedAt(id: string): number | null {
  const row = db.prepare("SELECT updated_at FROM qa_index WHERE id = ?").get(id) as
    | { updated_at: number }
    | undefined;
  return row ? row.updated_at : null;
}

export function getQaIndexCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM qa_index").get() as { count: number };
  return row.count;
}

/** 意味検索用: embedding生成済みの行のみ、Float32Arrayに変換して返す。 */
export function getAllQaIndexRowsWithEmbedding(): (QaDetail & { embedding: Float32Array })[] {
  const rows = db
    .prepare(
      "SELECT id, url, question, answer, embedding FROM qa_index WHERE embedding IS NOT NULL",
    )
    .all() as (QaIndexRow & { embedding: Buffer })[];
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    question: row.question,
    answer: row.answer,
    embedding: bufferToFloat32Array(row.embedding),
  }));
}

/** embedding生成スクリプト用: 全行を対象候補として返す。 */
export function getAllQaIndexChunkRows(): QaIndexChunkRow[] {
  const rows = db
    .prepare(
      `SELECT id, url, question, answer, content_hash, embedding, embedding_model, embedding_text_hash
       FROM qa_index`,
    )
    .all() as QaIndexRowWithEmbedding[];
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    question: row.question,
    answer: row.answer,
    contentHash: row.content_hash,
    embedding: row.embedding ? bufferToFloat32Array(row.embedding) : null,
    embeddingModel: row.embedding_model,
    embeddingTextHash: row.embedding_text_hash,
  }));
}

export function saveQaEmbedding(params: {
  id: string;
  embedding: number[];
  model: string;
  textHash: string;
}): void {
  db.prepare(
    `UPDATE qa_index
     SET embedding = ?, embedding_model = ?, embedding_dimensions = ?, embedding_text_hash = ?, embedding_updated_at = ?
     WHERE id = ?`,
  ).run(
    float32ArrayToBuffer(params.embedding),
    params.model,
    params.embedding.length,
    params.textHash,
    new Date().toISOString(),
    params.id,
  );
}
