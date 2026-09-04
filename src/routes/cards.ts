import { Router } from "express";
import { z } from "zod";
import { suggestCardNames } from "../cards/cardIndexRepository";
import {
  checkForCardListUpdateAndMaybeReindex,
  getCardIndexBuildStatus,
  startCardIndexBuildInBackground,
} from "../cards/cardIndexBuildJob";
import { fetchTotalCardCount } from "../cards/cardSearch";
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
cardsRouter.post("/api/cards/reindex", requireAdminSession, async (_req, res) => {
  // 管理画面の「全件再構築」ボタンからの呼び出しのため、30日以内に更新済みの
  // カードもスキップせず全件再取得する(Codexレビュー指摘: 従来はforceRefresh
  // を渡しておらず、実質的に差分更新にとどまっていた)。
  // あわせて、公式サイトの最新総数を先に取得しexpectedTotalとして渡す
  // (Codexレビュー指摘: これを渡さないと、判定基準がcard_indexのDB行数
  // 〈残存行を含み実際より多い〉ベースの緩い閾値のままになり、大幅な欠落を
  // 見逃しうる)。取得自体に失敗しても全件再構築の実行は妨げない(その場合は
  // 既知の記録値/DB行数ベースの従来通りの判定にフォールバックする)。
  const expectedTotal = await fetchTotalCardCount().catch(() => null);
  const started = startCardIndexBuildInBackground({ forceRefresh: true, expectedTotal });
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
