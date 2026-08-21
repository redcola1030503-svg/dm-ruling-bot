import { db } from "../config/db";
import { env } from "../config/env";
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
  /** 総合ルールのみ、条文本文(一覧でのプレビュー表示用)。それ以外はundefined。 */
  preview?: string;
};

/** キーワード検索(searchSourceItems)に対応する種別。カード・訂正事例は対象外。 */
export type SearchableSourceType = "generalRule" | "qa" | "ruleChange";

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
  if (sourceType === "generalRule") {
    // 総合ルールのみ、一覧でのプレビュー表示用にgeneral_rule_chunkの本文をJOINする。
    const rows = db
      .prepare(
        `SELECT srs.source_type as sourceType, srs.item_key as itemKey, srs.title, srs.url,
                srs.reference_count as referenceCount, srs.last_referenced_at as lastReferencedAt,
                grc.text as preview
         FROM source_reference_stat srs
         LEFT JOIN general_rule_chunk grc ON grc.rule_number = srs.item_key
         WHERE srs.source_type = 'generalRule'
         ORDER BY srs.reference_count DESC, srs.last_referenced_at DESC
         LIMIT ?`,
      )
      .all(limit) as SourceReferenceStat[];
    return rows;
  }

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

/**
 * 総合ルール/Q&A/ルール変更の全件データ(参照実績の有無に関わらず)からキーワード検索する。
 * 参照回数はsource_reference_statとLEFT JOINして埋め込む(実績が無ければ0)。
 */
export function searchSourceItems(
  sourceType: SearchableSourceType,
  keyword: string,
  limit: number,
): SourceReferenceStat[] {
  const likeKeyword = `%${keyword}%`;

  if (sourceType === "generalRule") {
    const rows = db
      .prepare(
        `SELECT grc.rule_number as itemKey, grc.text as preview,
                COALESCE(srs.reference_count, 0) as referenceCount,
                COALESCE(srs.last_referenced_at, 0) as lastReferencedAt
         FROM general_rule_chunk grc
         LEFT JOIN source_reference_stat srs
           ON srs.source_type = 'generalRule' AND srs.item_key = grc.rule_number
         WHERE grc.rule_number LIKE ? OR grc.text LIKE ?
         ORDER BY referenceCount DESC, grc.rule_number ASC
         LIMIT ?`,
      )
      .all(likeKeyword, likeKeyword, limit) as {
      itemKey: string;
      preview: string;
      referenceCount: number;
      lastReferencedAt: number;
    }[];
    return rows.map((row) => ({
      sourceType: "generalRule",
      itemKey: row.itemKey,
      title: `総合ルール ${row.itemKey}`,
      url: env.DM_GENERAL_RULE_PAGE_URL,
      referenceCount: row.referenceCount,
      lastReferencedAt: row.lastReferencedAt,
      preview: row.preview,
    }));
  }

  if (sourceType === "qa") {
    const rows = db
      .prepare(
        `SELECT qi.url as itemKey, substr(qi.question, 1, 60) as title, qi.url as url,
                COALESCE(srs.reference_count, 0) as referenceCount,
                COALESCE(srs.last_referenced_at, 0) as lastReferencedAt
         FROM qa_index qi
         LEFT JOIN source_reference_stat srs
           ON srs.source_type = 'qa' AND srs.item_key = qi.url
         WHERE qi.question LIKE ? OR qi.answer LIKE ?
         ORDER BY referenceCount DESC, qi.id DESC
         LIMIT ?`,
      )
      .all(likeKeyword, likeKeyword, limit) as Omit<SourceReferenceStat, "sourceType" | "preview">[];
    return rows.map((row) => ({ ...row, sourceType: "qa" }));
  }

  // ruleChange
  const rows = db
    .prepare(
      `SELECT rc.url as itemKey, rc.title as title, rc.url as url,
              COALESCE(srs.reference_count, 0) as referenceCount,
              COALESCE(srs.last_referenced_at, 0) as lastReferencedAt
       FROM rule_change_cache rc
       LEFT JOIN source_reference_stat srs
         ON srs.source_type = 'ruleChange' AND srs.item_key = rc.url
       WHERE rc.title LIKE ? OR rc.body LIKE ?
       ORDER BY referenceCount DESC, rc.updated_at DESC
       LIMIT ?`,
    )
    .all(likeKeyword, likeKeyword, limit) as Omit<SourceReferenceStat, "sourceType" | "preview">[];
  return rows.map((row) => ({ ...row, sourceType: "ruleChange" }));
}
