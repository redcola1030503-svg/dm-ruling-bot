import { db } from "../config/db";

export type KeywordAbility = {
  name: string;
  url: string;
  description: string;
};

export function upsertKeywordAbility(name: string, url: string, description: string): void {
  db.prepare(
    `INSERT INTO keyword_ability (name, url, description, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET url=excluded.url, description=excluded.description, updated_at=excluded.updated_at`,
  ).run(name, url, description, Date.now());
}

export function getKeywordAbilityUpdatedAt(name: string): number | null {
  const row = db.prepare("SELECT updated_at FROM keyword_ability WHERE name = ?").get(name) as
    | { updated_at: number }
    | undefined;
  return row ? row.updated_at : null;
}

export function getKeywordAbilityCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM keyword_ability").get() as { count: number };
  return row.count;
}

/** 質問文から抽出済みの用語(ruleConcepts)のうち、登録済みのキーワード能力に一致するものを返す。 */
export function getKeywordAbilitiesByNames(names: string[]): KeywordAbility[] {
  if (names.length === 0) return [];
  const placeholders = names.map(() => "?").join(", ");
  return db
    .prepare(`SELECT name, url, description FROM keyword_ability WHERE name IN (${placeholders})`)
    .all(...names) as KeywordAbility[];
}
