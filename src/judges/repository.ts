import { db } from "../config/db";
import type { Judge, JudgeRole, JudgeSession } from "./types";

type SessionRow = {
  user_id: string;
  judge_id: string;
  logged_in_at: number;
  role: string;
};

type JudgeRow = {
  id: string;
  role: string;
  created_at: number;
  created_by: string;
};

export function login(userId: string, judgeId: string): void {
  db.prepare(
    `INSERT INTO judge_session (user_id, judge_id, logged_in_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET judge_id = excluded.judge_id, logged_in_at = excluded.logged_in_at`,
  ).run(userId, judgeId, Date.now());
}

export function logout(userId: string): void {
  db.prepare("DELETE FROM judge_session WHERE user_id = ?").run(userId);
}

/**
 * ジャッジテーブルとJOINしてroleを取得する。judgeテーブルから削除された
 * ジャッジは、セッションが残っていてもJOINが失敗しnullになる(=自動的に
 * 認可されなくなる)。roleをセッション側にコピーして保持しないのは、管理者
 * 権限の剥奪(/judge_remove)を即座に反映させるため。
 */
export function getSession(userId: string): JudgeSession | null {
  const row = db
    .prepare(
      `SELECT s.user_id, s.judge_id, s.logged_in_at, j.role
       FROM judge_session s
       JOIN judge j ON j.id = s.judge_id
       WHERE s.user_id = ?`,
    )
    .get(userId) as SessionRow | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    judgeId: row.judge_id,
    loggedInAt: row.logged_in_at,
    role: row.role as JudgeRole,
  };
}

function rowToJudge(row: JudgeRow): Judge {
  return { id: row.id, role: row.role as JudgeRole, createdAt: row.created_at, createdBy: row.created_by };
}

export function getJudge(judgeId: string): Judge | null {
  const row = db.prepare("SELECT * FROM judge WHERE id = ?").get(judgeId) as JudgeRow | undefined;
  return row ? rowToJudge(row) : null;
}

export function listJudges(): Judge[] {
  const rows = db.prepare("SELECT * FROM judge ORDER BY created_at ASC").all() as JudgeRow[];
  return rows.map(rowToJudge);
}

export function addJudge(judgeId: string, role: JudgeRole, createdBy: string): void {
  db.prepare(
    `INSERT INTO judge (id, role, created_at, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET role = excluded.role`,
  ).run(judgeId, role, Date.now(), createdBy);
}

export function removeJudge(judgeId: string): boolean {
  const result = db.prepare("DELETE FROM judge WHERE id = ?").run(judgeId);
  return result.changes > 0;
}
