import { db } from "../config/db";

// 《零》のような1文字のカード名も検索できるよう1文字から許可する。
// 極端に短い(1〜2文字)クエリでも、呼び出し側(SUGGEST_LIMIT)で件数が絞られるため
// 結果が過剰になる心配はない。
const MIN_QUERY_LENGTH = 1;

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
// card_index(主要名)とcard_index_alt_name(サイキック/ドラグハート/ツインパクト等
// 複数面カードの、主要名以外の面の名前)の両方を対象にする。どちらの面の名前で
// 入力してもサジェストできるようにするため(過去の教訓: 裏面名がcard_indexに
// 登録されずサジェストから漏れていた不具合の修正)。
const SUGGEST_UNION_SQL = `
  SELECT id, name FROM card_index
  UNION
  SELECT id, name FROM card_index_alt_name
`;

// 主要名(card_index)と別名(card_index_alt_name)の両方に、同じidが別々のnameで
// 一致することがある(例: 表/裏どちらも同じ文字で始まるサイキック等)。GROUP BY id
// でid単位に集約し、1id1行だけを返す(重複がLIMIT枠を消費して件数が不足するのを防ぐ)。
// MIN(name)はLIKE条件を満たした名前の中からの選択なので、一致した面のいずれかの
// 名前が返る(一致していない方の名前が紛れ込むことはない)。
function suggestQuery(likePattern: string, limit: number): CardSuggestion[] {
  return db
    .prepare(
      `SELECT id, MIN(name) as name FROM (${SUGGEST_UNION_SQL}) WHERE name LIKE ? ESCAPE '\\' GROUP BY id ORDER BY name LIMIT ?`,
    )
    .all(likePattern, limit) as CardSuggestion[];
}

export function suggestCardNames(query: string, limit: number): CardSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const escaped = escapeLikePattern(trimmed);
  const seenIds = new Set<string>();
  const results: CardSuggestion[] = [];

  const prefixRows = suggestQuery(`${escaped}%`, limit);
  for (const row of prefixRows) {
    seenIds.add(row.id);
    results.push(row);
  }

  if (results.length < limit) {
    const partialRows = suggestQuery(`%${escaped}%`, limit);
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

/**
 * 主要名以外の面の名前(サイキックの裏面等)を登録する。同じidの既存の別名は
 * 一度全削除してから登録し直す(名前が変わった場合や面の数が減った場合に
 * 古い別名がゴミとして残らないようにするため)。
 */
export function replaceCardIndexAltNames(id: string, names: string[]): void {
  db.prepare("DELETE FROM card_index_alt_name WHERE id = ?").run(id);
  if (names.length === 0) return;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO card_index_alt_name (id, name, updated_at) VALUES (?, ?, ?)",
  );
  const now = Date.now();
  for (const name of names) {
    insert.run(id, name, now);
  }
}

/**
 * 主要名(card_index)と別名(card_index_alt_name)の更新を1トランザクションに
 * まとめる。別々のまま実行すると、別名側の更新で例外・プロセス停止が起きた
 * 場合に主要名だけが「更新済み」(updated_at更新)になり、通常の差分更新
 * (30日stale判定)では再実行されずalternateNamesが永久に反映されない不整合が
 * 起きうるため(billingTransaction.tsと同じBEGIN/COMMIT/ROLLBACKパターン)。
 */
export function upsertCardIndexEntryWithAltNames(
  id: string,
  name: string,
  url: string,
  altNames: string[],
): void {
  db.exec("BEGIN");
  try {
    upsertCardIndexEntry(id, name, url);
    replaceCardIndexAltNames(id, altNames);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
