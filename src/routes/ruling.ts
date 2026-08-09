import { Router } from "express";
import { z } from "zod";
import { produceRuling } from "../ruling/produceRuling";
import { logger } from "../utils/logger";
import { rulingRateLimiter } from "../utils/rateLimit";

export const rulingRouter = Router();

const rulingRequestSchema = z.object({
  question: z.string().min(1).max(1000),
});

rulingRouter.post("/api/ruling", rulingRateLimiter, async (req, res) => {
  const parsed = rulingRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  logger.info("ruling_request_received", { questionLength: parsed.data.question.length });

  const outcome = await produceRuling(parsed.data.question);
  const status = outcome.status === "ok" ? 200 : 502;
  res.status(status).json(outcome.result);
});
