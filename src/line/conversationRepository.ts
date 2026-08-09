import { db } from "../config/db";

export type ConversationRole = "user" | "assistant";

export type ConversationMessage = {
  role: ConversationRole;
  message: string;
};

const DEFAULT_HISTORY_LIMIT = 6;
const HISTORY_RETENTION_LIMIT = 10;

export function appendMessage(userId: string, role: ConversationRole, message: string): void {
  db.prepare(
    "INSERT INTO conversation_history (user_id, role, message, created_at) VALUES (?, ?, ?, ?)",
  ).run(userId, role, message, Date.now());

  // 各ユーザーにつき直近HISTORY_RETENTION_LIMIT件のみ保持する。
  db.prepare(
    `DELETE FROM conversation_history
     WHERE user_id = ?
       AND id NOT IN (
         SELECT id FROM conversation_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
  ).run(userId, userId, HISTORY_RETENTION_LIMIT);
}

export function getRecentHistory(
  userId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
): ConversationMessage[] {
  const rows = db
    .prepare(
      "SELECT role, message FROM conversation_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, limit) as ConversationMessage[];
  return rows.reverse();
}
