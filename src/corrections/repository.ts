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
  // ruling_job.result_jsonへの置換を試みても「ジャッジID」相当の文字列がまだ残って
  // いる(=既知の正規表現が対応していない未知の表記揺れ)行の件数。jobIdそのものは
  // 意図的に含めない(migrateLegacyCorrectionTitlesInResultJsonのコメント参照:
  // 認証不要のGET /api/ruling/jobs/:jobIdから直接内容を取得できる開示経路になるため)。
  unresolvedRulingJobResultJsonMarkerCount: number;
  // result_jsonがJSONとして解析できなかった行の件数(内容不明のため、表記揺れとは
  // 別カウントで報告する)。
  invalidRulingJobResultJsonCount: number;
  // 既知のジャッジID値そのものと一致した(ラベルは検出されなかった)行の件数。
  // 短い数値ID等はルール番号・年・URL等に偶然含まれやすく誤検知が多いため、
  // 確定した表記揺れ残存(上記2件)とは別カウントで報告するが、過去のインシデントで
  // 実際に漏洩したIDが4桁数値だった実績があるため、誤検知の可能性を理由に無条件で
  // 完了扱いにはしない。1件以上あれば呼び出し元は非ゼロ終了・要手動確認とする
  // (Codexレビュー指摘、2026-09-04)。
  possibleKnownIdCollisionRulingJobResultJsonCount: number;
};

// ラベルの表記揺れに依存しない監査のため、現在・過去に実在したジャッジIDの値
// そのものを集める(judgeテーブル: 現存するID、correction.judge_id: 削除済み
// ジャッジによる訂正にも残る過去のID)。値そのものはこの関数の外へは出さない
// (呼び出し元も、この戻り値を個々の値ごとログ・出力へ出してはならない)。
// migrateCorrectionCredentials()と、本番残存の個別復旧用スクリプト
// (src/scripts/repairEmbeddedLegacyCorrectionTitle.ts)の両方から使う。
export function getKnownJudgeIdsForLegacyTitleAudit(): string[] {
  return (
    db.prepare("SELECT id AS judge_id FROM judge UNION SELECT judge_id FROM correction").all() as {
      judge_id: string | null;
    }[]
  )
    .map((row) => row.judge_id)
    .filter((id): id is string => Boolean(id));
}

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

    const knownJudgeIds = getKnownJudgeIdsForLegacyTitleAudit();

    const {
      migrated: migratedRulingJobResultJson,
      unresolvedMarkerCount: unresolvedRulingJobResultJsonMarkerCount,
      invalidJsonCount: invalidRulingJobResultJsonCount,
      possibleKnownIdCollisionCount: possibleKnownIdCollisionRulingJobResultJsonCount,
    } = migrateLegacyCorrectionTitlesInResultJson(knownJudgeIds);

    db.exec("COMMIT");
    return {
      revokedSessions,
      migratedCorrections,
      migratedSourceReferenceStats,
      migratedRulingJobResultJson,
      unresolvedRulingJobResultJsonMarkerCount,
      invalidRulingJobResultJsonCount,
      possibleKnownIdCollisionRulingJobResultJsonCount,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
