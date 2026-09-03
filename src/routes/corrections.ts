import { Router } from "express";
import { z } from "zod";
import {
  deleteCorrection,
  getAllCorrections,
  getCorrectionById,
  getCorrectionsByJudgeId,
  saveCorrection,
  updateCorrectionRuling,
} from "../corrections/repository";
import { extractCardNameCandidates } from "../cards/extractCardNameCandidates";
import { requireJudgeSession } from "../judges/authMiddleware";
import { publicReadRateLimiter } from "../utils/rateLimit";
import { logger } from "../utils/logger";
import type { JudgeSession } from "../judges/types";

export const correctionsRouter = Router();

const correctionRequestSchema = z.object({
  originalQuestion: z.string().min(1).max(1000),
  botConclusion: z.string().min(1).max(2000),
  correctRuling: z.string().min(1).max(2000),
});

// 訂正対象をスレッド履歴(threadContext.ts)から自動特定する仕組みは無いため、
// クライアントが画面表示済みのoriginalQuestion/botConclusionを直接送る設計にする。
correctionsRouter.post("/api/corrections", requireJudgeSession, (req, res) => {
  const parsed = correctionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const session = res.locals.judgeSession as JudgeSession;
  saveCorrection({
    originalQuestion: parsed.data.originalQuestion,
    botConclusion: parsed.data.botConclusion,
    correctRuling: parsed.data.correctRuling,
    cardNames: extractCardNameCandidates(parsed.data.originalQuestion),
    // correctedByには生のセッショントークン(session.userId)を保存しない。
    // 過去にここへ生トークンを保存しており、管理者向け一覧(GET /api/corrections)
    // 経由でセッション乗っ取りに使える値がそのまま閲覧できてしまっていた(T008)。
    correctedBy: session.judgeId,
    judgeId: session.judgeId,
  });

  logger.info("api_correction_saved", { judgeId: session.judgeId });
  res.status(201).json({ status: "ok" });
});

// 管理者は全訂正、それ以外のジャッジは自分(judgeId)の訂正のみを取得する。
correctionsRouter.get("/api/corrections", requireJudgeSession, (_req, res) => {
  const session = res.locals.judgeSession as JudgeSession;
  const corrections =
    session.role === "admin" ? getAllCorrections() : getCorrectionsByJudgeId(session.judgeId);
  res.json({ corrections });
});

// 利用統計画面で「訂正事例」タブの項目をタップした際、訂正1件の全文を表示するために使う。
// 一般ユーザーも閲覧できる公開情報として扱うため、correctedBy・judgeIdは両方とも
// 公開レスポンスに含めない。judgeIdはログインの唯一の認証情報であり(T008)、これを
// 公開すると誰でもそのIDでログインできてしまう。
correctionsRouter.get("/api/corrections/:id", publicReadRateLimiter, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const correction = getCorrectionById(id);
  if (!correction) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json({ correction: { ...correction, correctedBy: "", judgeId: "" } });
});

const updateCorrectionRequestSchema = z.object({
  correctRuling: z.string().min(1).max(2000),
});

correctionsRouter.patch("/api/corrections/:id", requireJudgeSession, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const parsed = updateCorrectionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const session = res.locals.judgeSession as JudgeSession;
  const existing = getCorrectionById(id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (session.role !== "admin" && existing.judgeId !== session.judgeId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  updateCorrectionRuling(id, parsed.data.correctRuling);
  logger.info("api_correction_updated", { id, updatedBy: session.judgeId });
  res.json({ correction: getCorrectionById(id) });
});

correctionsRouter.delete("/api/corrections/:id", requireJudgeSession, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const session = res.locals.judgeSession as JudgeSession;
  const existing = getCorrectionById(id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (session.role !== "admin" && existing.judgeId !== session.judgeId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const removed = deleteCorrection(id);
  logger.info("api_correction_withdrawn", { id, withdrawnBy: session.judgeId });
  res.json({ removed });
});
