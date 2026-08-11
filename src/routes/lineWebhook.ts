import { Router } from "express";
import type { WebhookEvent } from "@line/bot-sdk";
import { env } from "../config/env";
import { verifyLineSignature } from "../line/verifySignature";
import { replyText } from "../line/replyMessage";
import { formatRulingForLine } from "../line/formatRuling";
import { appendMessage, getRecentHistory } from "../line/conversationRepository";
import { produceRuling } from "../ruling/produceRuling";
import { extractCardNameCandidates } from "../cards/extractCardNameCandidates";
import { saveCorrection } from "../corrections/repository";
import { addJudge, getJudge, getSession, listJudges, login, logout, removeJudge } from "../judges/repository";
import { logger } from "../utils/logger";
import { webhookRateLimiter } from "../utils/rateLimit";

export const lineWebhookRouter = Router();

const MAX_QUESTION_LENGTH = 1000;
const CORRECTION_COMMAND_PREFIX = "/訂正 ";
const CORRECTION_HISTORY_LOOKBACK = 10;
const WHOAMI_COMMAND = "/whoami";
const LOGIN_COMMAND_PREFIX = "/login ";
const LOGOUT_COMMAND = "/logout";
const JUDGE_ADD_COMMAND_PREFIX = "/judge_add ";
const JUDGE_REMOVE_COMMAND_PREFIX = "/judge_remove ";
const JUDGE_LIST_COMMAND = "/judge_list";

function buildContextualQuestion(userId: string, latestMessage: string): string {
  const history = getRecentHistory(userId);
  if (history.length === 0) return latestMessage;

  const historyText = history
    .map((entry) => `${entry.role === "user" ? "ユーザー" : "Bot"}: ${entry.message}`)
    .join("\n");

  return `これまでの会話:\n${historyText}\n\n新しい質問:\n${latestMessage}`;
}

async function handleLoginCommand(userId: string, replyToken: string, text: string): Promise<void> {
  const judgeId = text.slice(LOGIN_COMMAND_PREFIX.length).trim();
  if (!judgeId) {
    await replyText(replyToken, "ジャッジIDが空です。「/login ジャッジID」の形式で送信してください。");
    return;
  }

  const judge = getJudge(judgeId);
  if (!judge) {
    await replyText(replyToken, "無効なジャッジIDです。");
    return;
  }

  login(userId, judgeId);
  logger.info("judge_login", { judgeId, role: judge.role });
  const roleLabel = judge.role === "admin" ? "管理者" : "ジャッジ";
  await replyText(
    replyToken,
    `ジャッジID「${judgeId}」(${roleLabel})でログインしました。/訂正 コマンドが利用できます。`,
  );
}

async function handleLogoutCommand(userId: string, replyToken: string): Promise<void> {
  logout(userId);
  await replyText(replyToken, "ログアウトしました。");
}

async function handleJudgeAddCommand(userId: string, replyToken: string, text: string): Promise<void> {
  const session = getSession(userId);
  if (!session || session.role !== "admin") {
    await replyText(replyToken, "この操作には管理者権限が必要です。");
    return;
  }

  const targetJudgeId = text.slice(JUDGE_ADD_COMMAND_PREFIX.length).trim();
  if (!targetJudgeId) {
    await replyText(replyToken, "ジャッジIDが空です。「/judge_add ジャッジID」の形式で送信してください。");
    return;
  }

  addJudge(targetJudgeId, "judge", session.judgeId);
  logger.info("judge_added", { targetJudgeId, addedBy: session.judgeId });
  await replyText(replyToken, `ジャッジID「${targetJudgeId}」を登録しました。`);
}

async function handleJudgeRemoveCommand(userId: string, replyToken: string, text: string): Promise<void> {
  const session = getSession(userId);
  if (!session || session.role !== "admin") {
    await replyText(replyToken, "この操作には管理者権限が必要です。");
    return;
  }

  const targetJudgeId = text.slice(JUDGE_REMOVE_COMMAND_PREFIX.length).trim();
  if (!targetJudgeId) {
    await replyText(replyToken, "ジャッジIDが空です。「/judge_remove ジャッジID」の形式で送信してください。");
    return;
  }

  if (targetJudgeId === session.judgeId) {
    await replyText(replyToken, "自分自身を削除することはできません。");
    return;
  }

  const removed = removeJudge(targetJudgeId);
  logger.info("judge_removed", { targetJudgeId, removedBy: session.judgeId, removed });
  await replyText(
    replyToken,
    removed ? `ジャッジID「${targetJudgeId}」を削除しました。` : `ジャッジID「${targetJudgeId}」は登録されていません。`,
  );
}

async function handleJudgeListCommand(userId: string, replyToken: string): Promise<void> {
  const session = getSession(userId);
  if (!session || session.role !== "admin") {
    await replyText(replyToken, "この操作には管理者権限が必要です。");
    return;
  }

  const judges = listJudges();
  if (judges.length === 0) {
    await replyText(replyToken, "登録されているジャッジがいません。");
    return;
  }

  const roleLabel = { judge: "ジャッジ", admin: "管理者" } as const;
  const list = judges.map((judge) => `・${judge.id}(${roleLabel[judge.role]})`).join("\n");
  await replyText(replyToken, `登録済みジャッジ一覧:\n${list}`);
}

async function handleCorrectionCommand(
  userId: string,
  replyToken: string,
  text: string,
): Promise<void> {
  const session = getSession(userId);
  if (!session) {
    await replyText(replyToken, "この操作にはログインが必要です。「/login ジャッジID」でログインしてください。");
    return;
  }

  const correctRuling = text.slice(CORRECTION_COMMAND_PREFIX.length).trim();
  if (!correctRuling) {
    await replyText(replyToken, "訂正内容が空です。「/訂正 正しい裁定内容」の形式で送信してください。");
    return;
  }

  const history = getRecentHistory(userId, CORRECTION_HISTORY_LOOKBACK);
  const lastAssistant = [...history].reverse().find((entry) => entry.role === "assistant");
  const lastUser = [...history].reverse().find((entry) => entry.role === "user");

  if (!lastAssistant || !lastUser) {
    await replyText(replyToken, "訂正対象となる直近のBot回答が見つかりませんでした。");
    return;
  }

  saveCorrection({
    originalQuestion: lastUser.message,
    botConclusion: lastAssistant.message,
    correctRuling,
    cardNames: extractCardNameCandidates(lastUser.message),
    correctedBy: userId,
    judgeId: session.judgeId,
  });

  logger.info("correction_saved", { judgeId: session.judgeId });
  await replyText(replyToken, "訂正を記録しました。今後の類似する質問で参考情報として活用します。");
}

async function handleTextMessageEvent(event: WebhookEvent): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text;

  if (!userId) {
    // グループ/複数人トークなどuserIdが取得できない場合は会話履歴を使わず単発質問として扱う。
    const outcome = await produceRuling(text.slice(0, MAX_QUESTION_LENGTH));
    await replyText(replyToken, formatRulingForLine(outcome.result));
    return;
  }

  if (text === WHOAMI_COMMAND) {
    await replyText(replyToken, `あなたのユーザーID:\n${userId}`);
    return;
  }

  if (text.startsWith(LOGIN_COMMAND_PREFIX)) {
    await handleLoginCommand(userId, replyToken, text);
    return;
  }

  if (text === LOGOUT_COMMAND) {
    await handleLogoutCommand(userId, replyToken);
    return;
  }

  if (text.startsWith(JUDGE_ADD_COMMAND_PREFIX)) {
    await handleJudgeAddCommand(userId, replyToken, text);
    return;
  }

  if (text.startsWith(JUDGE_REMOVE_COMMAND_PREFIX)) {
    await handleJudgeRemoveCommand(userId, replyToken, text);
    return;
  }

  if (text === JUDGE_LIST_COMMAND) {
    await handleJudgeListCommand(userId, replyToken);
    return;
  }

  if (text.startsWith(CORRECTION_COMMAND_PREFIX)) {
    await handleCorrectionCommand(userId, replyToken, text);
    return;
  }

  if (text.length > MAX_QUESTION_LENGTH) {
    await replyText(replyToken, `質問文が長すぎます(${MAX_QUESTION_LENGTH}文字以内でお願いします)。`);
    return;
  }

  const contextualQuestion = buildContextualQuestion(userId, text);
  const outcome = await produceRuling(contextualQuestion);
  const replyBody = formatRulingForLine(outcome.result);

  await replyText(replyToken, replyBody);

  appendMessage(userId, "user", text);
  appendMessage(userId, "assistant", outcome.result.conclusion);
}

lineWebhookRouter.post("/webhook/line", webhookRateLimiter, async (req, res) => {
  if (!env.LINE_CHANNEL_SECRET) {
    res.status(503).json({ error: "line_not_configured" });
    return;
  }

  const signature = req.header("x-line-signature");
  if (!verifyLineSignature(req.rawBody, signature, env.LINE_CHANNEL_SECRET)) {
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  // LINEプラットフォームへは即座に200を返し、以降は非同期で処理する(replyTokenの有効期限対策)。
  res.status(200).end();

  const events: WebhookEvent[] = req.body?.events ?? [];
  for (const event of events) {
    try {
      await handleTextMessageEvent(event);
    } catch (error) {
      logger.error("line_event_handling_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});
