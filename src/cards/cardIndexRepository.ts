import { db } from "../config/db";

const MIN_QUERY_LENGTH = 2;

export type CardSuggestion = { id: string; name: string };

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 質問入力中のカード名サジェスト用。card_indexテーブル(事前クロール済みの
 * 全カード名インデックス、buildCardIndex.tsで生成)に対し、前方一致を優先し、
 * 足りない分を部分一致で補う。クエリが短すぎるとヒット数が多くなりすぎて
 * 有用なサジェストにならないため、MIN_QUERY_LENGTH未満は空配列を返す。
 */
export function suggestCardNames(query: string, limit: number): CardSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const escaped = escapeLikePattern(trimmed);
  const seenIds = new Set<string>();
  const results: CardSuggestion[] = [];

  const prefixRows = db
    .prepare("SELECT id, name FROM card_index WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?")
    .all(`${escaped}%`, limit) as CardSuggestion[];
  for (const row of prefixRows) {
    seenIds.add(row.id);
    results.push(row);
  }

  if (results.length < limit) {
    const partialRows = db
      .prepare("SELECT id, name FROM card_index WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?")
      .all(`%${escaped}%`, limit) as CardSuggestion[];
    for (const row of partialRows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      results.push(row);
      if (results.length >= limit) break;
    }
  }

  return results;
}

export function upsertCardIndexEntry(id: string, name: string, url: string): void {
  db.prepare(
    `INSERT INTO card_index (id, name, url, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, updated_at=excluded.updated_at`,
  ).run(id, name, url, Date.now());
}

export function getCardIndexUpdatedAt(id: string): number | null {
  const row = db.prepare("SELECT updated_at FROM card_index WHERE id = ?").get(id) as
    | { updated_at: number }
    | undefined;
  return row ? row.updated_at : null;
}

export function getCardIndexCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM card_index").get() as { count: number };
  return row.count;
}

const TOTAL_COUNT_META_KEY = "last_known_total_count";

/**
 * 前回のカード一覧件数チェック時に記録した公式サイトの全カード数(total_count)。
 * フル再クロール(1.6時間)をせずに「新カードが追加された可能性」を軽量に
 * 検知するための比較対象。未実施ならnull。
 */
export function getLastKnownTotalCount(): number | null {
  const row = db.prepare("SELECT value FROM card_index_meta WHERE key = ?").get(TOTAL_COUNT_META_KEY) as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : null;
}

export function setLastKnownTotalCount(count: number): void {
  db.prepare(
    `INSERT INTO card_index_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(TOTAL_COUNT_META_KEY, String(count), Date.now());
}
