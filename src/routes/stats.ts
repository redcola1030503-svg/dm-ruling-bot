import { Router } from "express";
import { z } from "zod";
import { getTopCardQueries, getTopSourceReferences, searchSourceItems } from "../stats/statsRepository";
import { getGeneralRuleChunkByRuleNumber } from "../rules/generalRuleRepository";
import { publicReadRateLimiter } from "../utils/rateLimit";

export const statsRouter = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const limitSchema = z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT);

// 利用統計は一般ユーザーも閲覧できる公開情報として扱う(集計値・条文全文のみで、
// 個人情報は含まれない)。ログイン不要。
statsRouter.get("/api/stats/cards", publicReadRateLimiter, (req, res) => {
  const parsedLimit = limitSchema.safeParse(req.query.limit);
  if (!parsedLimit.success) {
    res.status(400).json({ error: "invalid_request", details: parsedLimit.error.flatten() });
    return;
  }
  res.json({ cards: getTopCardQueries(parsedLimit.data) });
});

const sourceTypeSchema = z.enum(["card", "qa", "ruleChange", "generalRule", "correction", "verifiedRulingPrinciple"]);
const searchableSourceTypeSchema = z.enum(["generalRule", "qa", "ruleChange"]);
const keywordSchema = z.string().trim().min(1).max(200);

statsRouter.get("/api/stats/sources", publicReadRateLimiter, (req, res) => {
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

  // qが指定された場合は、参照実績の有無に関わらず全件データからキーワード検索する
  // (総合ルール/Q&A/ルール変更のみ対応。カード・訂正事例は非対応)。
  if (req.query.q !== undefined) {
    const parsedKeyword = keywordSchema.safeParse(req.query.q);
    if (!parsedKeyword.success) {
      res.status(400).json({ error: "invalid_request", details: parsedKeyword.error.flatten() });
      return;
    }
    const parsedSearchableType = searchableSourceTypeSchema.safeParse(req.query.type);
    if (!parsedSearchableType.success) {
      res.status(400).json({ error: "search_not_supported_for_type" });
      return;
    }
    const items = searchSourceItems(parsedSearchableType.data, parsedKeyword.data, parsedLimit.data);
    res.json({ items });
    return;
  }

  res.json({ items: getTopSourceReferences(parsedType.data, parsedLimit.data) });
});

// 利用統計画面で「総合ルール」タブの項目をタップした際、条文の全文を表示するために使う。
statsRouter.get("/api/stats/general-rules/:ruleNumber", publicReadRateLimiter, (req, res) => {
  const parsedParams = z.object({ ruleNumber: z.string().min(1) }).safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "invalid_request", details: parsedParams.error.flatten() });
    return;
  }

  const chunk = getGeneralRuleChunkByRuleNumber(parsedParams.data.ruleNumber);
  if (!chunk) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ruleNumber: chunk.ruleNumber, text: chunk.text });
});
