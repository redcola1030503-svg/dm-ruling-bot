import { Router } from "express";
import { z } from "zod";
import { suggestCardNames } from "../cards/cardIndexRepository";
import { rulingRateLimiter } from "../utils/rateLimit";

export const cardsRouter = Router();

const SUGGEST_LIMIT = 10;

const suggestQuerySchema = z.object({
  q: z.string().min(1).max(100),
});

cardsRouter.get("/api/cards/suggest", rulingRateLimiter, (req, res) => {
  const parsed = suggestQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const suggestions = suggestCardNames(parsed.data.q, SUGGEST_LIMIT);
  res.json({ suggestions });
});
