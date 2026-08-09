import { db } from "../config/db";
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
