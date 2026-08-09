import { db } from "../config/db";
import type { GeneralRuleChunk } from "./types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日(総合ルールは頻繁に変わらない)
const CRAWL_META_KEY = "general_rule";

type ChunkRow = {
  rule_number: string;
  text: string;
};

export function isGeneralRuleCacheFresh(): boolean {
  const row = db
    .prepare("SELECT crawled_at FROM general_rule_crawl_meta WHERE key = ?")
    .get(CRAWL_META_KEY) as { crawled_at: number } | undefined;
  if (!row) return false;
  return Date.now() - row.crawled_at < CACHE_TTL_MS;
}

export function saveGeneralRuleChunks(chunks: GeneralRuleChunk[]): void {
  db.exec("DELETE FROM general_rule_chunk");
  const stmt = db.prepare("INSERT INTO general_rule_chunk (rule_number, text) VALUES (?, ?)");
  for (const chunk of chunks) {
    stmt.run(chunk.ruleNumber, chunk.text);
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
