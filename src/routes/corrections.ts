import { Router } from "express";
import { z } from "zod";
import { saveCorrection } from "../corrections/repository";
import { extractCardNameCandidates } from "../cards/extractCardNameCandidates";
import { requireJudgeSession } from "../judges/authMiddleware";
import { logger } from "../utils/logger";
import type { JudgeSession } from "../judges/types";

export const correctionsRouter = Router();

const correctionRequestSchema = z.object({
  originalQuestion: z.string().min(1).max(1000),
  botConclusion: z.string().min(1).max(2000),
  correctRuling: z.string().min(1).max(2000),
});

// LINE版は会話履歴DB(LINE userId紐付け)から直前のQ&Aを推測するが、モバイル版は
// ステートレスな/api/ruling呼び出しのみで会話履歴を持たないため、クライアントが
// 画面表示済みのoriginalQuestion/botConclusionを直接送る設計にする。
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
    correctedBy: session.userId,
    judgeId: session.judgeId,
  });

  logger.info("api_correction_saved", { judgeId: session.judgeId });
  res.status(201).json({ status: "ok" });
});
