import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getJudge, login, logout } from "../judges/repository";
import { requireJudgeSession } from "../judges/authMiddleware";
import { authRateLimiter } from "../utils/rateLimit";
import { logger } from "../utils/logger";
import type { JudgeSession } from "../judges/types";

export const authRouter = Router();

const SESSION_TOKEN_BYTES = 32;

const loginRequestSchema = z.object({
  judgeId: z.string().min(1).max(100),
});

authRouter.post("/api/login", authRateLimiter, (req, res) => {
  const parsed = loginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const judge = getJudge(parsed.data.judgeId);
  if (!judge) {
    res.status(401).json({ error: "invalid_judge_id" });
    return;
  }

  const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");
  login(token, judge.id);
  logger.info("api_judge_login", { judgeId: judge.id, role: judge.role });
  res.json({ token, judgeId: judge.id, role: judge.role });
});

authRouter.post("/api/logout", requireJudgeSession, (_req, res) => {
  const session = res.locals.judgeSession as JudgeSession;
  logout(session.userId);
  res.json({ status: "ok" });
});

// アプリ起動時、保存済みトークンがまだ有効か(ログアウトされていないか、
// ジャッジが削除されていないか)を確認するためのエンドポイント。
authRouter.get("/api/session", requireJudgeSession, (_req, res) => {
  const session = res.locals.judgeSession as JudgeSession;
  res.json({ judgeId: session.judgeId, role: session.role });
});
