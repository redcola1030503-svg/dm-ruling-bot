import { runCardIndexBuild } from "./cardIndexCrawler";
import type { CardIndexBuildProgress, CardIndexBuildSummary } from "./cardIndexCrawler";
import { fetchTotalCardCount } from "./cardSearch";
import { getLastKnownTotalCount, setLastKnownTotalCount } from "./cardIndexRepository";
import { logger } from "../utils/logger";

export type CardIndexBuildStatus =
  | { status: "idle" }
  | ({ status: "running"; startedAt: number } & CardIndexBuildProgress)
  | ({ status: "completed"; startedAt: number; finishedAt: number } & CardIndexBuildSummary)
  | { status: "failed"; startedAt: number; finishedAt: number; error: string };

// このプロセス内メモリで状態管理する(Renderは単一インスタンスのStarterプラン
// なので、DBやジョブキューを別途持ち込むほどの規模ではない)。
let currentStatus: CardIndexBuildStatus = { status: "idle" };

export function getCardIndexBuildStatus(): CardIndexBuildStatus {
  return currentStatus;
}

/**
 * card_index再構築をバックグラウンドで開始する(呼び出し元はawaitせず即座に
 * 制御を返す想定)。既に実行中の場合は何もせずfalseを返す(管理者が誤って
 * 多重起動しても安全)。
 */
export function startCardIndexBuildInBackground(): boolean {
  if (currentStatus.status === "running") return false;

  const startedAt = Date.now();
  currentStatus = { status: "running", startedAt, processed: 0, total: 0, updated: 0, skipped: 0, failed: 0 };

  runCardIndexBuild((progress) => {
    currentStatus = { status: "running", startedAt, ...progress };
  })
    .then((summary) => {
      currentStatus = { status: "completed", startedAt, finishedAt: Date.now(), ...summary };
    })
    .catch((error) => {
      currentStatus = {
        status: "failed",
        startedAt,
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      logger.error("card_index_build_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
}

export type CardUpdateCheckResult = {
  hasUpdate: boolean;
  previousCount: number | null;
  currentCount: number;
  checkedAt: number;
  reindexStarted: boolean;
};

/**
 * 公式サイトの全カード数(total_count)を1リクエストだけ取得し、前回記録値と
 * 比較する軽量チェック。差分があれば(=新カードが追加された可能性)、
 * バックグラウンドでcard_index再構築を自動的に開始する。
 */
export async function checkForCardListUpdateAndMaybeReindex(): Promise<CardUpdateCheckResult> {
  const currentCount = await fetchTotalCardCount();
  if (currentCount === null) {
    throw new Error("公式サイトからtotal_countを取得できませんでした");
  }

  const previousCount = getLastKnownTotalCount();
  const hasUpdate = previousCount === null || currentCount !== previousCount;
  setLastKnownTotalCount(currentCount);

  const reindexStarted = hasUpdate ? startCardIndexBuildInBackground() : false;

  logger.info("card_list_update_checked", { previousCount, currentCount, hasUpdate, reindexStarted });

  return { hasUpdate, previousCount, currentCount, checkedAt: Date.now(), reindexStarted };
}
