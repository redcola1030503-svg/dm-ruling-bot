import { Router } from "express";
import { z } from "zod";
import { addJudge, listJudges, removeJudge } from "../judges/repository";
import { requireAdminSession } from "../judges/authMiddleware";
import { logger } from "../utils/logger";
import type { JudgeSession } from "../judges/types";

export const judgesRouter = Router();

judgesRouter.get("/api/judges", requireAdminSession, (_req, res) => {
  res.json({ judges: listJudges() });
});

const addJudgeRequestSchema = z.object({
  judgeId: z.string().min(1).max(100),
});

judgesRouter.post("/api/judges", requireAdminSession, (req, res) => {
  const parsed = addJudgeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const session = res.locals.judgeSession as JudgeSession;
  // LINE版の/judge_addと同様、このAPI経由で追加できるのは"judge"ロールのみ
  // (管理者への昇格はこのAPIでは不可)。
  addJudge(parsed.data.judgeId, "judge", session.judgeId);
  logger.info("api_judge_added", { targetJudgeId: parsed.data.judgeId, addedBy: session.judgeId });
  res.status(201).json({ status: "ok" });
});

judgesRouter.delete("/api/judges/:judgeId", requireAdminSession, (req, res) => {
  const session = res.locals.judgeSession as JudgeSession;
  const targetJudgeId = req.params.judgeId as string;

  if (targetJudgeId === session.judgeId) {
    res.status(409).json({ error: "cannot_remove_self" });
    return;
  }

  const removed = removeJudge(targetJudgeId);
  logger.info("api_judge_removed", { targetJudgeId, removedBy: session.judgeId, removed });
  res.json({ removed });
});
