import { Router } from "express";
import { z } from "zod";
import { getTopCardQueries, getTopSourceReferences } from "../stats/statsRepository";
import { requireAdminSession } from "../judges/authMiddleware";

export const statsRouter = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const limitSchema = z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT);

statsRouter.get("/api/stats/cards", requireAdminSession, (req, res) => {
  const parsedLimit = limitSchema.safeParse(req.query.limit);
  if (!parsedLimit.success) {
    res.status(400).json({ error: "invalid_request", details: parsedLimit.error.flatten() });
    return;
  }
  res.json({ cards: getTopCardQueries(parsedLimit.data) });
});

const sourceTypeSchema = z.enum(["card", "qa", "ruleChange", "generalRule", "correction"]);

statsRouter.get("/api/stats/sources", requireAdminSession, (req, res) => {
  const parsedType = sourceTypeSchema.safeParse(req.query.type);
  if (!parsedType.success) {
    res.status(400).json({ error: "invalid_request", details: parsedType.error.flatten() });
    return;
  }
  const parsedLimit = limitSchema.safeParse(req.query.limit);
  if (!parsedLimit.success) {
    res.status(400).json({ error: "invalid_request", details: parsedLimit.error.flatten() });
    return;
  }
  res.json({ items: getTopSourceReferences(parsedType.data, parsedLimit.data) });
});
