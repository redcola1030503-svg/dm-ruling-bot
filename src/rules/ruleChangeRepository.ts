import { db } from "../config/db";
import type { RuleChangeDetail, RuleChangeListItem } from "./types";

const LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const DETAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日(記事は基本的に更新されない)
const CRAWL_META_KEY = "rule_change_list";

type RuleChangeRow = {
  id: string;
  url: string;
  title: string;
  date: string;
  body: string | null;
  updated_at: number;
};

function rowToListItem(row: RuleChangeRow): RuleChangeListItem {
  return { id: row.id, url: row.url, title: row.title, date: row.date };
}

export function isListCacheFresh(): boolean {
  const row = db
    .prepare("SELECT crawled_at FROM rule_change_crawl_meta WHERE key = ?")
    .get(CRAWL_META_KEY) as { crawled_at: number } | undefined;
  if (!row) return false;
  return Date.now() - row.crawled_at < LIST_CACHE_TTL_MS;
}

export function markListCacheCrawled(): void {
  db.prepare(
    `INSERT INTO rule_change_crawl_meta (key, crawled_at) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET crawled_at = excluded.crawled_at`,
  ).run(CRAWL_META_KEY, Date.now());
}

export function saveRuleChangeListItems(items: RuleChangeListItem[]): void {
  const stmt = db.prepare(
    `INSERT INTO rule_change_cache (id, url, title, date, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, title=excluded.title, date=excluded.date, updated_at=excluded.updated_at`,
  );
  for (const item of items) {
    stmt.run(item.id, item.url, item.title, item.date, Date.now());
  }
}

export function getAllCachedListItems(): RuleChangeListItem[] {
  const rows = db.prepare("SELECT * FROM rule_change_cache ORDER BY updated_at DESC").all() as RuleChangeRow[];
  return rows.map(rowToListItem);
}

export function getCachedRuleChangeDetail(id: string): RuleChangeDetail | null {
  const row = db.prepare("SELECT * FROM rule_change_cache WHERE id = ?").get(id) as
    | RuleChangeRow
    | undefined;
  if (!row || !row.body) return null;
  if (Date.now() - row.updated_at > DETAIL_CACHE_TTL_MS) return null;
  return { id: row.id, url: row.url, title: row.title, date: row.date, body: row.body };
}

export function saveRuleChangeDetail(detail: RuleChangeDetail): void {
  db.prepare(
    `INSERT INTO rule_change_cache (id, url, title, date, body, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, title=excluded.title, date=excluded.date, body=excluded.body, updated_at=excluded.updated_at`,
  ).run(detail.id, detail.url, detail.title, detail.date, detail.body, Date.now());
}
