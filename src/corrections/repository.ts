import { db } from "../config/db";
import { migrateLegacyCorrectionTitlesInResultJson } from "../ruling/rulingJobRepository";
import type { Correction } from "./types";

type CorrectionRow = {
  id: number;
  original_question: string;
  bot_conclusion: string;
  correct_ruling: string;
  card_names: string;
  corrected_by: string;
  judge_id: string;
  created_at: number;
};

function rowToCorrection(row: CorrectionRow): Correction {
  return {
    id: row.id,
    originalQuestion: row.original_question,
    botConclusion: row.bot_conclusion,
    correctRuling: row.correct_ruling,
    cardNames: JSON.parse(row.card_names) as string[],
    correctedBy: row.corrected_by,
    judgeId: row.judge_id,
    createdAt: row.created_at,
  };
}

export function saveCorrection(input: {
  originalQuestion: string;
  botConclusion: string;
  correctRuling: string;
  cardNames: string[];
  correctedBy: string;
  judgeId: string;
}): void {
  db.prepare(
    `INSERT INTO correction (original_question, bot_conclusion, correct_ruling, card_names, corrected_by, judge_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.originalQuestion,
    input.botConclusion,
    input.correctRuling,
    JSON.stringify(input.cardNames),
    input.correctedBy,
    input.judgeId,
    Date.now(),
  );
}

export function getAllCorrections(): Correction[] {
  const rows = db
    .prepare("SELECT * FROM correction ORDER BY created_at DESC")
    .all() as CorrectionRow[];
  return rows.map(rowToCorrection);
}

export function getCorrectionsByJudgeId(judgeId: string): Correction[] {
  const rows = db
    .prepare("SELECT * FROM correction WHERE judge_id = ? ORDER BY created_at DESC")
    .all(judgeId) as CorrectionRow[];
  return rows.map(rowToCorrection);
}

export function getCorrectionById(id: number): Correction | null {
  const row = db.prepare("SELECT * FROM correction WHERE id = ?").get(id) as
    | CorrectionRow
    | undefined;
  return row ? rowToCorrection(row) : null;
}

export function updateCorrectionRuling(id: number, correctRuling: string): boolean {
  const result = db
    .prepare("UPDATE correction SET correct_ruling = ? WHERE id = ?")
    .run(correctRuling, id);
  return result.changes > 0;
}

export function deleteCorrection(id: number): boolean {
  const result = db.prepare("DELETE FROM correction WHERE id = ?").run(id);
  return result.changes > 0;
}

export type CorrectionCredentialMigrationSummary = {
  revokedSessions: number;
  migratedCorrections: number;
  migratedSourceReferenceStats: number;
  migratedRulingJobResultJson: number;
};

/**
 * T008: 過去に`corrected_by`へ保存されてしまった生のセッショントークンをjudgeIdへ
 * 置き換え、該当する既存セッションを失効させる(トークンが既に管理者へ露出していた
 * 可能性があるため)。あわせて、旧タイトル(judgeId入り)のまま残っている
 * source_reference_stat(訂正事例分)・ruling_job.result_json(Codex Review 2で
 * 追加発覚。スレッド付きジョブは無期限保持されるため要移行)も現行の非識別タイトルへ揃える。
 * 1回限りの本番マイグレーション用(Render Web Shellから手動実行する)。
 *
 * **注意(Codex Review 2指摘、未解消)**: このマイグレーションはjudgeId自体を
 * 再発行しない。バグ1(公開APIでのjudgeIdマスク漏れ)が本番稼働していた期間に
 * judgeIdを知られた第三者は、修正後も引き続きそのIDでログインできてしまう
 * (`POST /api/login`はjudgeId単独で新しいトークンを発行するため)。judgeId自体の
 * 再発行はT008のOut of Scopeとしてユーザーへ別途推奨している。
 */
export function migrateCorrectionCredentials(): CorrectionCredentialMigrationSummary {
  db.exec("BEGIN");
  try {
    const revokedSessions = Number(
      db
        .prepare(
          `DELETE FROM judge_session
           WHERE user_id IN (SELECT corrected_by FROM correction WHERE corrected_by != judge_id)`,
        )
        .run().changes,
    );

    const migratedCorrections = Number(
      db
        .prepare("UPDATE correction SET corrected_by = judge_id WHERE corrected_by != judge_id")
        .run().changes,
    );

    // item_key(source_reference_stat)は訂正事例の場合String(correction.id)のため、
    // retrieveEvidence.tsが現行生成する「過去の訂正事例 #<id>(公認ジャッジによる記録)」
    // と同じ形式をSQL側の文字列結合で再現する。
    const migratedSourceReferenceStats = Number(
      db
        .prepare(
          `UPDATE source_reference_stat
           SET title = '過去の訂正事例 #' || item_key || '(公認ジャッジによる記録)'
           WHERE source_type = 'correction' AND title LIKE '%ジャッジID%'`,
        )
        .run().changes,
    );

    const migratedRulingJobResultJson = migrateLegacyCorrectionTitlesInResultJson();

    db.exec("COMMIT");
    return { revokedSessions, migratedCorrections, migratedSourceReferenceStats, migratedRulingJobResultJson };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
