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

export type CardIndexBuildOptions = {
  // trueの場合、30日以内に更新済みのカードもすべて再取得する(「全件再構築」)。
  // 省略時は既存の差分更新(30日以内はスキップ)のまま。
  forceRefresh?: boolean;
  // 呼び出し元がこの実行の直前に公式サイトから取得した最新の総数。
  // 不完全クロール検出の比較基準として、既知の記録値より優先して使われる。
  expectedTotal?: number | null;
  // ジョブの成否が確定した時点(completed/failed)で呼ばれる。呼び出し元が
  // 「本当に信頼できる結果か」に応じた後処理(例: 更新検知の記録確定)を
  // 行うためのフック。このフック自体が例外を投げても、ビルド自体の成否
  // (currentStatus)には影響させない(下記実装を参照)。
  onSettled?: (result: { ok: true; summary: CardIndexBuildSummary } | { ok: false; error: unknown }) => void;
};

/**
 * card_index再構築をバックグラウンドで開始する(呼び出し元はawaitせず即座に
 * 制御を返す想定)。既に実行中の場合は何もせずfalseを返す(管理者が誤って
 * 多重起動しても安全)。
 */
export function startCardIndexBuildInBackground(options?: CardIndexBuildOptions): boolean {
  if (currentStatus.status === "running") return false;

  const startedAt = Date.now();
  currentStatus = { status: "running", startedAt, processed: 0, total: 0, updated: 0, skipped: 0, failed: 0 };

  // onSettledは呼び出し元(checkForCardListUpdateAndMaybeReindex等)が渡す
  // 任意のコールバックであり、その中身(setLastKnownTotalCount等)が例外を
  // 投げる可能性を完全には排除できない。.then()の中で例外を投げると、
  // 同じPromiseチェーンの.catch()に流れてビルド自体が失敗したかのように
  // currentStatusを上書きしてしまう(Codexレビュー指摘)。フック自体の失敗は
  // ログに残すだけに留め、ビルドの成否判定には影響させない。
  function callOnSettledSafely(
    result: { ok: true; summary: CardIndexBuildSummary } | { ok: false; error: unknown },
  ): void {
    try {
      options?.onSettled?.(result);
    } catch (hookError) {
      logger.error("card_index_build_onSettled_failed", {
        error: hookError instanceof Error ? hookError.message : String(hookError),
      });
    }
  }

  runCardIndexBuild(
    (progress) => {
      currentStatus = { status: "running", startedAt, ...progress };
    },
    { forceRefresh: options?.forceRefresh, expectedTotal: options?.expectedTotal },
  )
    .then((summary) => {
      currentStatus = { status: "completed", startedAt, finishedAt: Date.now(), ...summary };
      callOnSettledSafely({ ok: true, summary });
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
      callOnSettledSafely({ ok: false, error });
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

  let reindexStarted = false;
  if (hasUpdate) {
    // 観測値(currentCount)は、これを反映するはずの再構築が実際に成功して
    // 初めて「既知の値」として確定させる。開始できなかった場合(多重起動)・
    // 途中でプロセスが再起動した場合・不完全なクロールを検出して失敗した
    // 場合のいずれでも記録を進めず、次回チェックで再試行させる
    // (Codexレビュー指摘: 従来は再構築の成否を待たずに確定していた)。
    reindexStarted = startCardIndexBuildInBackground({
      expectedTotal: currentCount,
      onSettled: (result) => {
        // failed>0(個別カード取得の一部失敗)を成功扱いにすると、取得できな
        // かった新規カードが残ったまま次回チェックで再試行されなくなる
        // (Codexレビュー指摘)。全件取得できた場合のみ観測値を確定する。
        // さらに、runCardIndexBuild内の比率ガード(99%)だけでは、例えば
        // currentCountが11,700件のとき11,583件(99%)取得できただけでも
        // クロール自体は成功扱いになり得る。それだけでlast_known_total_count
        // を確定すると、残り最大117件(概ね1ページ分)の欠落が次回以降
        // 再試行されなくなってしまう(Codexレビュー指摘)。実際にDBへ反映
        // できた総数(summary.totalCount)がcurrentCount以上であることまで
        // 確認してから確定する。
        if (result.ok && result.summary.failed === 0 && result.summary.totalCount >= currentCount) {
          setLastKnownTotalCount(currentCount);
        }
      },
    });
  } else {
    setLastKnownTotalCount(currentCount);
  }

  logger.info("card_list_update_checked", { previousCount, currentCount, hasUpdate, reindexStarted });

  return { hasUpdate, previousCount, currentCount, checkedAt: Date.now(), reindexStarted };
}
