import { db } from "../config/db";
import type { JudgeSession } from "./types";

type SessionRow = {
  user_id: string;
  judge_id: string;
  logged_in_at: number;
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

export function getSession(userId: string): JudgeSession | null {
  const row = db.prepare("SELECT * FROM judge_session WHERE user_id = ?").get(userId) as
    | SessionRow
    | undefined;
  if (!row) return null;
  return { userId: row.user_id, judgeId: row.judge_id, loggedInAt: row.logged_in_at };
}
