import { db } from "../config/db";
import { bufferToFloat32Array, float32ArrayToBuffer } from "../embeddings/embeddingUtils";
import { computeGeneralRuleContentHash } from "./contentHash";
import type { GeneralRuleChunk, GeneralRuleChunkRow } from "./types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日(総合ルールは頻繁に変わらない)
const CRAWL_META_KEY = "general_rule";

type ChunkRow = {
  rule_number: string;
  text: string;
};

type ChunkRowWithEmbedding = ChunkRow & {
  id: number;
  content_hash: string;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_text_hash: string | null;
};

export function isGeneralRuleCacheFresh(): boolean {
  const row = db
    .prepare("SELECT crawled_at FROM general_rule_crawl_meta WHERE key = ?")
    .get(CRAWL_META_KEY) as { crawled_at: number } | undefined;
  if (!row) return false;
  return Date.now() - row.crawled_at < CACHE_TTL_MS;
}

/**
 * 内容が変わっていない行はembeddingを保持したまま残す差分更新。
 * (単純なDELETE&INSERTだとクロールのたびにembeddingが全て失われてしまうため)
 */
export function saveGeneralRuleChunks(chunks: GeneralRuleChunk[]): void {
  const existingHashes = new Set(
    (
      db
        .prepare("SELECT content_hash FROM general_rule_chunk WHERE content_hash IS NOT NULL")
        .all() as { content_hash: string }[]
    ).map((row) => row.content_hash),
  );

  const insertStmt = db.prepare(
    "INSERT INTO general_rule_chunk (rule_number, text, content_hash) VALUES (?, ?, ?)",
  );

  const newHashes = new Set<string>();
  for (const chunk of chunks) {
    const hash = computeGeneralRuleContentHash(chunk);
    newHashes.add(hash);
    if (!existingHashes.has(hash)) {
      insertStmt.run(chunk.ruleNumber, chunk.text, hash);
    }
  }

  // 新しいクロール結果に存在しなくなった行(条文の削除・統合等)を削除する。
  const staleHashes = [...existingHashes].filter((hash) => !newHashes.has(hash));
  if (staleHashes.length > 0) {
    const placeholders = staleHashes.map(() => "?").join(",");
    db.prepare(`DELETE FROM general_rule_chunk WHERE content_hash IN (${placeholders})`).run(
      ...staleHashes,
    );
  }

  db.prepare(
    `INSERT INTO general_rule_crawl_meta (key, crawled_at) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET crawled_at = excluded.crawled_at`,
  ).run(CRAWL_META_KEY, Date.now());
}

export function getAllCachedGeneralRuleChunks(): GeneralRuleChunk[] {
  const rows = db.prepare("SELECT rule_number, text FROM general_rule_chunk").all() as ChunkRow[];
  return rows.map((row) => ({ ruleNumber: row.rule_number, text: row.text }));
}

/** 利用統計画面で条文の全文を表示する用途など、条文番号1件を直接引きたい場合に使う。 */
export function getGeneralRuleChunkByRuleNumber(ruleNumber: string): GeneralRuleChunk | null {
  const row = db
    .prepare("SELECT rule_number, text FROM general_rule_chunk WHERE rule_number = ?")
    .get(ruleNumber) as ChunkRow | undefined;
  return row ? { ruleNumber: row.rule_number, text: row.text } : null;
}

function rowToChunkRow(row: ChunkRowWithEmbedding): GeneralRuleChunkRow {
  return {
    id: row.id,
    ruleNumber: row.rule_number,
    text: row.text,
    contentHash: row.content_hash,
    embedding: row.embedding ? bufferToFloat32Array(row.embedding) : null,
    embeddingModel: row.embedding_model,
    embeddingTextHash: row.embedding_text_hash,
  };
}

export function getAllGeneralRuleChunkRows(): GeneralRuleChunkRow[] {
  const rows = db
    .prepare(
      `SELECT id, rule_number, text, content_hash, embedding, embedding_model, embedding_text_hash
       FROM general_rule_chunk`,
    )
    .all() as ChunkRowWithEmbedding[];
  return rows.map(rowToChunkRow);
}

export function saveGeneralRuleEmbedding(params: {
  id: number;
  embedding: number[];
  model: string;
  textHash: string;
}): void {
  db.prepare(
    `UPDATE general_rule_chunk
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
