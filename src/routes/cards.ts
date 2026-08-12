import { Router } from "express";
import { z } from "zod";
import { suggestCardNames } from "../cards/cardIndexRepository";
import {
  checkForCardListUpdateAndMaybeReindex,
  getCardIndexBuildStatus,
  startCardIndexBuildInBackground,
} from "../cards/cardIndexBuildJob";
import { requireAdminSession } from "../judges/authMiddleware";
import { rulingRateLimiter } from "../utils/rateLimit";
import { logger } from "../utils/logger";

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

// card_index(サジェスト用インデックス)の再構築。管理者限定。バックグラウンドで
// 実行され、この呼び出し自体は即座に返る(完了を待たない)。進捗は
// GET /api/cards/reindex/status でポーリングする。
cardsRouter.post("/api/cards/reindex", requireAdminSession, (_req, res) => {
  const started = startCardIndexBuildInBackground();
  if (!started) {
    res.status(409).json({ error: "already_running", current: getCardIndexBuildStatus() });
    return;
  }
  res.status(202).json({ status: "started" });
});

cardsRouter.get("/api/cards/reindex/status", requireAdminSession, (_req, res) => {
  res.json(getCardIndexBuildStatus());
});

// 公式サイトの全カード数を1リクエストだけ取得し、前回チェック時と比較する
// 軽量な更新確認。差分があれば自動的にreindexを開始する。フル再クロール
// (約1.6時間)をせずに「更新の必要がありそうか」だけを確認したい場合に使う。
cardsRouter.post("/api/cards/reindex/check", requireAdminSession, async (_req, res) => {
  try {
    const result = await checkForCardListUpdateAndMaybeReindex();
    res.json(result);
  } catch (error) {
    logger.error("card_update_check_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: "official_site_unreachable" });
  }
});
