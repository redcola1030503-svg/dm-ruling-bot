import { db } from "../config/db";
import type { EvidenceSource } from "../ruling/types";

export type CardQueryStat = {
  cardId: string;
  cardName: string;
  cardUrl: string;
  queryCount: number;
  lastQueriedAt: number;
};

export type SourceReferenceStat = {
  sourceType: EvidenceSource["sourceType"];
  itemKey: string;
  title: string;
  url: string;
  referenceCount: number;
  lastReferencedAt: number;
};

/**
 * カード名が一意に確定して質問された回数を記録する。カードID(公式サイトの
 * カードID)単位でカウントし、同じカードが表記ゆれで質問されても1つに集約される。
 */
export function recordCardQuery(cardId: string, cardName: string, cardUrl: string): void {
  db.prepare(
    `INSERT INTO card_query_stat (card_id, card_name, card_url, query_count, last_queried_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(card_id) DO UPDATE SET
       card_name = excluded.card_name,
       card_url = excluded.card_url,
       query_count = query_count + 1,
       last_queried_at = excluded.last_queried_at`,
  ).run(cardId, cardName, cardUrl, Date.now());
}

/**
 * 総合ルール条文・公式Q&A・ルール変更・訂正事例・カードのうち、実際に裁定の
 * 根拠(sources)として採用された個別項目の参照回数を記録する。
 */
export function recordSourceReference(
  sourceType: EvidenceSource["sourceType"],
  itemKey: string,
  title: string,
  url: string,
): void {
  db.prepare(
    `INSERT INTO source_reference_stat (source_type, item_key, title, url, reference_count, last_referenced_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(source_type, item_key) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       reference_count = reference_count + 1,
       last_referenced_at = excluded.last_referenced_at`,
  ).run(sourceType, itemKey, title, url, Date.now());
}

export function getTopCardQueries(limit: number): CardQueryStat[] {
  const rows = db
    .prepare(
      `SELECT card_id as cardId, card_name as cardName, card_url as cardUrl,
              query_count as queryCount, last_queried_at as lastQueriedAt
       FROM card_query_stat
       ORDER BY query_count DESC, last_queried_at DESC
       LIMIT ?`,
    )
    .all(limit) as CardQueryStat[];
  return rows;
}

export function getTopSourceReferences(
  sourceType: EvidenceSource["sourceType"],
  limit: number,
): SourceReferenceStat[] {
  const rows = db
    .prepare(
      `SELECT source_type as sourceType, item_key as itemKey, title, url,
              reference_count as referenceCount, last_referenced_at as lastReferencedAt
       FROM source_reference_stat
       WHERE source_type = ?
       ORDER BY reference_count DESC, last_referenced_at DESC
       LIMIT ?`,
    )
    .all(sourceType, limit) as SourceReferenceStat[];
  return rows;
}
