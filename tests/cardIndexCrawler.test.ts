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
const upsertCardIndexEntryWithAltNames = vi.fn();
vi.mock("../src/cards/cardIndexRepository", () => ({
  getCardIndexCount: () => getCardIndexCount(),
  getCardIndexUpdatedAt: (id: string) => getCardIndexUpdatedAt(id),
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
    upsertCardIndexEntryWithAltNames.mockReset();
    getCardIndexCount.mockReturnValue(1);
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
