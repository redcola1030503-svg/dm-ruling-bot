import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardInfo, CardSearchHit } from "../src/cards/types";

const fetchCardListPage = vi.fn<(keyword: string, pagenum: number) => Promise<CardSearchHit[]>>();
const getOfficialCard = vi.fn<(hit: CardSearchHit, options?: { force?: boolean }) => Promise<CardInfo | null>>();
vi.mock("../src/cards/cardSearch", () => ({
  fetchCardListPage: (keyword: string, pagenum: number) => fetchCardListPage(keyword, pagenum),
  getOfficialCard: (hit: CardSearchHit, options?: { force?: boolean }) => getOfficialCard(hit, options),
}));

const getCardIndexCount = vi.fn<() => number>();
const getCardIndexUpdatedAt = vi.fn<(id: string) => number | null>();
const getLastKnownTotalCount = vi.fn<() => number | null>();
const upsertCardIndexEntryWithAltNames = vi.fn();
vi.mock("../src/cards/cardIndexRepository", () => ({
  getCardIndexCount: () => getCardIndexCount(),
  getCardIndexUpdatedAt: (id: string) => getCardIndexUpdatedAt(id),
  getLastKnownTotalCount: () => getLastKnownTotalCount(),
  upsertCardIndexEntryWithAltNames: (
    id: string,
    name: string,
    url: string,
    altNames: string[],
  ) => upsertCardIndexEntryWithAltNames(id, name, url, altNames),
}));

const { runCardIndexBuild } = await import("../src/cards/cardIndexCrawler");

function makeCard(overrides: Partial<CardInfo>): CardInfo {
  return {
    id: "dm37-021",
    url: "https://example.com/dm37-021",
    name: "時空の英雄アンタッチャブル",
    alternateNames: ["変幻の覚醒者アンタッチャブル・パワード"],
    cardType: "サイキック・クリーチャー",
    civilization: "光",
    rarity: "VR",
    power: "5000",
    cost: "5",
    mana: "0",
    race: "キカイヒーロー",
    cardText: "W・ブレイカー",
    flavorText: "",
    illustrator: "",
    qaListUrl: null,
    faces: [],
    ...overrides,
  };
}

describe("runCardIndexBuild", () => {
  beforeEach(() => {
    fetchCardListPage.mockReset();
    getOfficialCard.mockReset();
    getCardIndexCount.mockReset();
    getCardIndexUpdatedAt.mockReset();
    getLastKnownTotalCount.mockReset();
    upsertCardIndexEntryWithAltNames.mockReset();
    getCardIndexCount.mockReturnValue(1);
    getLastKnownTotalCount.mockReturnValue(null);
  });

  it("通常実行: 30日以内に更新済みのカードはgetOfficialCardを呼ばずスキップする", async () => {
    fetchCardListPage.mockResolvedValueOnce([{ id: "dm37-021", url: "https://example.com/dm37-021" }]);
    fetchCardListPage.mockResolvedValue([]);
    getCardIndexUpdatedAt.mockReturnValue(Date.now()); // 更新済み扱い

    const summary = await runCardIndexBuild();

    expect(getOfficialCard).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.updated).toBe(0);
  });

  it("通常実行: 更新済みでもforceRefresh:trueならスキップせずgetOfficialCardをforce:trueで呼ぶ", async () => {
    fetchCardListPage.mockResolvedValueOnce([{ id: "dm37-021", url: "https://example.com/dm37-021" }]);
    fetchCardListPage.mockResolvedValue([]);
    getCardIndexUpdatedAt.mockReturnValue(Date.now()); // 更新済みだがforceで無視されるべき
    getOfficialCard.mockResolvedValueOnce(makeCard({}));

    const summary = await runCardIndexBuild(undefined, { forceRefresh: true });

    expect(getOfficialCard).toHaveBeenCalledWith({ id: "dm37-021", url: "https://example.com/dm37-021" }, {
      force: true,
    });
    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(0);
  });

  it("収集件数が0件なら例外を投げる(公式サイト応答異常の検出)", async () => {
    fetchCardListPage.mockResolvedValue([]);

    await expect(runCardIndexBuild()).rejects.toThrow(/0件/);
    expect(upsertCardIndexEntryWithAltNames).not.toHaveBeenCalled();
  });

  it("収集件数が既存登録数から大幅に減少していたら例外を投げる(不完全クロールの検出)", async () => {
    getCardIndexCount.mockReturnValue(100);
    fetchCardListPage.mockResolvedValueOnce([{ id: "dm37-021", url: "https://example.com/dm37-021" }]);
    fetchCardListPage.mockResolvedValue([]);

    await expect(runCardIndexBuild()).rejects.toThrow(/大幅に減少/);
    expect(upsertCardIndexEntryWithAltNames).not.toHaveBeenCalled();
  });

  it("getLastKnownTotalCountが記録済みならgetCardIndexCount(残存行を含み得る)より優先して判定基準にする", async () => {
    getCardIndexCount.mockReturnValue(1000); // 残存行を含む多めのDB件数
    getLastKnownTotalCount.mockReturnValue(120); // 前回チェック時点の公式サイト総数
    fetchCardListPage.mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({ id: `dm-${i}`, url: `https://example.com/dm-${i}` })),
    );
    fetchCardListPage.mockResolvedValue([]);
    getOfficialCard.mockResolvedValue(makeCard({}));

    // 100件はgetLastKnownTotalCount(120件)の50%(60件)を上回るため正常完了する。
    // getCardIndexCount(1000件)を基準にしていたら誤って失敗扱いになってしまう。
    await expect(runCardIndexBuild()).resolves.toBeDefined();
  });

  it("ページネーション上限に達した場合は例外を投げる(終端検出の失敗を疑う)", async () => {
    let call = 0;
    fetchCardListPage.mockImplementation(async () => {
      call += 1;
      return [{ id: `dm-${call}`, url: `https://example.com/dm-${call}` }];
    });
    getOfficialCard.mockResolvedValue(makeCard({}));

    await expect(runCardIndexBuild()).rejects.toThrow(/ページネーション上限/);
  }, 20000);

  it("ページ途中の単発の応答異常(一時的な空応答)は同じページを再試行して復帰する", async () => {
    const responses: CardSearchHit[][] = [
      [{ id: "dm-1", url: "https://example.com/dm-1" }], // page1: 正常
      [], // page2 1回目: 一時的な空応答
      [{ id: "dm-2", url: "https://example.com/dm-2" }], // page2 2回目(再試行): 復帰
    ];
    let call = 0;
    fetchCardListPage.mockImplementation(async () => responses[call++] ?? []);
    getCardIndexUpdatedAt.mockReturnValue(null);
    getOfficialCard.mockResolvedValue(makeCard({}));

    const summary = await runCardIndexBuild();

    // 単発の空応答で即座に終端扱いしていれば1件のままだが、再試行により
    // dm-2も収集できているはず。
    expect(summary.processed).toBe(2);
    expect(upsertCardIndexEntryWithAltNames).toHaveBeenCalledTimes(2);
  });

  it("expectedTotal指定時は、より厳格な基準(99%)で不完全クロールを検出する", async () => {
    getCardIndexCount.mockReturnValue(1); // 緩い基準(50%)なら通ってしまう値
    fetchCardListPage.mockResolvedValueOnce(
      Array.from({ length: 90 }, (_, i) => ({ id: `dm-${i}`, url: `https://example.com/dm-${i}` })),
    );
    fetchCardListPage.mockResolvedValue([]);
    getOfficialCard.mockResolvedValue(makeCard({}));

    // 90件はexpectedTotal(100件)の99%(99件)を下回るため、expectedTotal
    // 指定時は失敗扱いになる(getCardIndexCountベースの緩い基準なら通ってしまう)。
    await expect(runCardIndexBuild(undefined, { expectedTotal: 100 })).rejects.toThrow(/大幅に減少/);
  });

  it("expectedTotal指定時、99%以上取得できていれば正常完了する", async () => {
    getCardIndexCount.mockReturnValue(1);
    fetchCardListPage.mockResolvedValueOnce(
      Array.from({ length: 99 }, (_, i) => ({ id: `dm-${i}`, url: `https://example.com/dm-${i}` })),
    );
    fetchCardListPage.mockResolvedValue([]);
    getOfficialCard.mockResolvedValue(makeCard({}));

    await expect(runCardIndexBuild(undefined, { expectedTotal: 100 })).resolves.toBeDefined();
  });

  it("取得したカードのalternateNamesをupsertCardIndexEntryWithAltNamesへそのまま渡す", async () => {
    fetchCardListPage.mockResolvedValueOnce([{ id: "dm37-021", url: "https://example.com/dm37-021" }]);
    fetchCardListPage.mockResolvedValue([]);
    getCardIndexUpdatedAt.mockReturnValue(null); // 未登録
    getOfficialCard.mockResolvedValueOnce(
      makeCard({ alternateNames: ["変幻の覚醒者アンタッチャブル・パワード"] }),
    );

    await runCardIndexBuild();

    expect(upsertCardIndexEntryWithAltNames).toHaveBeenCalledWith(
      "dm37-021",
      "時空の英雄アンタッチャブル",
      "https://example.com/dm37-021",
      ["変幻の覚醒者アンタッチャブル・パワード"],
    );
  });
});
