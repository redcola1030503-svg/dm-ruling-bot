import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardIndexBuildProgress, CardIndexBuildSummary } from "../src/cards/cardIndexCrawler";

const runCardIndexBuild = vi.fn<
  (
    onProgress?: (progress: CardIndexBuildProgress) => void,
    options?: { forceRefresh?: boolean },
  ) => Promise<CardIndexBuildSummary>
>();
vi.mock("../src/cards/cardIndexCrawler", () => ({
  runCardIndexBuild: (
    onProgress?: (progress: CardIndexBuildProgress) => void,
    options?: { forceRefresh?: boolean },
  ) => runCardIndexBuild(onProgress, options),
}));

const fetchTotalCardCount = vi.fn<() => Promise<number | null>>();
vi.mock("../src/cards/cardSearch", () => ({
  fetchTotalCardCount: () => fetchTotalCardCount(),
}));

const getLastKnownTotalCount = vi.fn<() => number | null>();
const setLastKnownTotalCount = vi.fn<(count: number) => void>();
vi.mock("../src/cards/cardIndexRepository", () => ({
  getLastKnownTotalCount: () => getLastKnownTotalCount(),
  setLastKnownTotalCount: (count: number) => setLastKnownTotalCount(count),
}));

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("cardIndexBuildJob", () => {
  beforeEach(() => {
    vi.resetModules();
    runCardIndexBuild.mockReset();
    fetchTotalCardCount.mockReset();
    getLastKnownTotalCount.mockReset();
    setLastKnownTotalCount.mockReset();
  });

  describe("startCardIndexBuildInBackground / getCardIndexBuildStatus", () => {
    it("idle状態からtrueを返しrunningになる", async () => {
      const { startCardIndexBuildInBackground, getCardIndexBuildStatus } =
        await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));

      const started = startCardIndexBuildInBackground();

      expect(started).toBe(true);
      expect(getCardIndexBuildStatus()).toMatchObject({ status: "running", processed: 0, total: 0 });
    });

    it("実行中に呼ぶとfalseを返し、runCardIndexBuildは1回しか呼ばれない", async () => {
      const { startCardIndexBuildInBackground, getCardIndexBuildStatus } =
        await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));

      const first = startCardIndexBuildInBackground();
      const second = startCardIndexBuildInBackground();

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(runCardIndexBuild).toHaveBeenCalledTimes(1);
      expect(getCardIndexBuildStatus().status).toBe("running");
    });

    it("progressコールバックで状態が更新される", async () => {
      const { startCardIndexBuildInBackground, getCardIndexBuildStatus } =
        await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockImplementation(
        (onProgress) =>
          new Promise(() => {
            onProgress?.({ processed: 50, total: 100, updated: 40, skipped: 5, failed: 5 });
          }),
      );

      startCardIndexBuildInBackground();

      expect(getCardIndexBuildStatus()).toMatchObject({ status: "running", processed: 50, updated: 40 });
    });

    it("成功時はcompletedになる", async () => {
      const { startCardIndexBuildInBackground, getCardIndexBuildStatus } =
        await import("../src/cards/cardIndexBuildJob");
      const summary: CardIndexBuildSummary = {
        processed: 100,
        total: 100,
        updated: 90,
        skipped: 9,
        failed: 1,
        totalCount: 11654,
      };
      runCardIndexBuild.mockResolvedValue(summary);

      startCardIndexBuildInBackground();
      await flushMicrotasks();

      expect(getCardIndexBuildStatus()).toMatchObject({ status: "completed", ...summary });
    });

    it("失敗時はfailedになりエラーメッセージを記録する", async () => {
      const { startCardIndexBuildInBackground, getCardIndexBuildStatus } =
        await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockRejectedValue(new Error("network error"));

      startCardIndexBuildInBackground();
      await flushMicrotasks();

      expect(getCardIndexBuildStatus()).toMatchObject({ status: "failed", error: "network error" });
    });

    it("完了時にonSettledが例外を投げてもcompleted状態は覆されない", async () => {
      const { startCardIndexBuildInBackground, getCardIndexBuildStatus } =
        await import("../src/cards/cardIndexBuildJob");
      const summary: CardIndexBuildSummary = {
        processed: 100,
        total: 100,
        updated: 100,
        skipped: 0,
        failed: 0,
        totalCount: 11700,
      };
      runCardIndexBuild.mockResolvedValue(summary);
      const onSettled = vi.fn(() => {
        throw new Error("hook error");
      });

      startCardIndexBuildInBackground({ onSettled });
      await flushMicrotasks();

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(getCardIndexBuildStatus()).toMatchObject({ status: "completed", ...summary });
    });

    it("expectedTotalを渡すとrunCardIndexBuildへそのまま伝播する", async () => {
      const { startCardIndexBuildInBackground } = await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));

      startCardIndexBuildInBackground({ expectedTotal: 11700 });

      expect(runCardIndexBuild).toHaveBeenCalledWith(expect.any(Function), {
        forceRefresh: undefined,
        expectedTotal: 11700,
      });
    });

    it("forceRefresh:trueを渡すとrunCardIndexBuildへそのまま伝播する(全件再構築)", async () => {
      const { startCardIndexBuildInBackground } = await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));

      startCardIndexBuildInBackground({ forceRefresh: true });

      expect(runCardIndexBuild).toHaveBeenCalledWith(expect.any(Function), { forceRefresh: true });
    });

    it("完了時にonSettledがok:trueで呼ばれる", async () => {
      const { startCardIndexBuildInBackground } = await import("../src/cards/cardIndexBuildJob");
      const summary: CardIndexBuildSummary = {
        processed: 100,
        total: 100,
        updated: 90,
        skipped: 9,
        failed: 1,
        totalCount: 11654,
      };
      runCardIndexBuild.mockResolvedValue(summary);
      const onSettled = vi.fn();

      startCardIndexBuildInBackground({ onSettled });
      await flushMicrotasks();

      expect(onSettled).toHaveBeenCalledWith({ ok: true, summary });
    });

    it("失敗時にonSettledがok:falseで呼ばれる", async () => {
      const { startCardIndexBuildInBackground } = await import("../src/cards/cardIndexBuildJob");
      const error = new Error("network error");
      runCardIndexBuild.mockRejectedValue(error);
      const onSettled = vi.fn();

      startCardIndexBuildInBackground({ onSettled });
      await flushMicrotasks();

      expect(onSettled).toHaveBeenCalledWith({ ok: false, error });
    });
  });

  describe("checkForCardListUpdateAndMaybeReindex", () => {
    it("total_count取得失敗時は例外を投げる", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(null);

      await expect(checkForCardListUpdateAndMaybeReindex()).rejects.toThrow();
    });

    it("初回(previousCountがnull)はhasUpdate=trueでreindexを開始する", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11654);
      getLastKnownTotalCount.mockReturnValue(null);
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));

      const result = await checkForCardListUpdateAndMaybeReindex();

      expect(result).toMatchObject({
        hasUpdate: true,
        previousCount: null,
        currentCount: 11654,
        reindexStarted: true,
      });
      // reindexがまだ完了していない間は観測値を確定させない
      // (Codexレビュー指摘: 従来は再構築の成否を待たずに即座に確定していた)。
      expect(setLastKnownTotalCount).not.toHaveBeenCalled();
    });

    it("reindexが全件成功して初めて観測値を確定する", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11700);
      getLastKnownTotalCount.mockReturnValue(11654);
      const summary: CardIndexBuildSummary = {
        processed: 100,
        total: 100,
        updated: 100,
        skipped: 0,
        failed: 0,
        totalCount: 11700,
      };
      runCardIndexBuild.mockResolvedValue(summary);

      await checkForCardListUpdateAndMaybeReindex();
      await flushMicrotasks();

      expect(setLastKnownTotalCount).toHaveBeenCalledWith(11700);
    });

    it("個別カード取得に一部失敗があれば観測値を確定しない(次回チェックで再試行させる)", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11700);
      getLastKnownTotalCount.mockReturnValue(11654);
      const summary: CardIndexBuildSummary = {
        processed: 100,
        total: 100,
        updated: 99,
        skipped: 0,
        failed: 1,
        totalCount: 11699,
      };
      runCardIndexBuild.mockResolvedValue(summary);

      await checkForCardListUpdateAndMaybeReindex();
      await flushMicrotasks();

      expect(setLastKnownTotalCount).not.toHaveBeenCalled();
    });

    it("failed=0でもDB反映総数が直近取得値を下回っていれば観測値を確定しない(1ページ分程度の欠落を見逃さない)", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11700);
      getLastKnownTotalCount.mockReturnValue(11654);
      const summary: CardIndexBuildSummary = {
        processed: 11583,
        total: 11583,
        updated: 11583,
        skipped: 0,
        failed: 0,
        // 99%(11700件の99%=11583件)は取得できたため比率ガードは通過するが、
        // 直近取得値(11700)には届いていない = 約117件欠落している。
        totalCount: 11583,
      };
      runCardIndexBuild.mockResolvedValue(summary);

      await checkForCardListUpdateAndMaybeReindex();
      await flushMicrotasks();

      expect(setLastKnownTotalCount).not.toHaveBeenCalled();
    });

    it("reindexが失敗した場合は観測値を確定しない(次回チェックで再試行させる)", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11700);
      getLastKnownTotalCount.mockReturnValue(11654);
      runCardIndexBuild.mockRejectedValue(new Error("official site error"));

      await checkForCardListUpdateAndMaybeReindex();
      await flushMicrotasks();

      expect(setLastKnownTotalCount).not.toHaveBeenCalled();
    });

    it("件数が変わっていなければhasUpdate=falseでreindexを開始しない", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11654);
      getLastKnownTotalCount.mockReturnValue(11654);

      const result = await checkForCardListUpdateAndMaybeReindex();

      expect(result).toMatchObject({
        hasUpdate: false,
        previousCount: 11654,
        currentCount: 11654,
        reindexStarted: false,
      });
      expect(runCardIndexBuild).not.toHaveBeenCalled();
    });

    it("件数が変わっていればhasUpdate=trueでreindexを開始する", async () => {
      const { checkForCardListUpdateAndMaybeReindex } = await import("../src/cards/cardIndexBuildJob");
      fetchTotalCardCount.mockResolvedValue(11700);
      getLastKnownTotalCount.mockReturnValue(11654);
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));

      const result = await checkForCardListUpdateAndMaybeReindex();

      expect(result).toMatchObject({
        hasUpdate: true,
        previousCount: 11654,
        currentCount: 11700,
        reindexStarted: true,
      });
    });

    it("既にreindex実行中ならreindexStarted=falseになる", async () => {
      const { checkForCardListUpdateAndMaybeReindex, startCardIndexBuildInBackground } =
        await import("../src/cards/cardIndexBuildJob");
      runCardIndexBuild.mockImplementation(() => new Promise(() => {}));
      startCardIndexBuildInBackground();

      fetchTotalCardCount.mockResolvedValue(11700);
      getLastKnownTotalCount.mockReturnValue(11654);

      const result = await checkForCardListUpdateAndMaybeReindex();

      expect(result.reindexStarted).toBe(false);
    });
  });
});
