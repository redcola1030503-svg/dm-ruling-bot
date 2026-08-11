import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardInfo, CardSearchHit } from "../src/cards/types";

vi.mock("../src/cards/cardRepository", () => ({
  getCachedCard: vi.fn(),
  saveCardToCache: vi.fn(),
}));

const searchOfficialCards =
  vi.fn<(keyword: string, options?: { maxResults?: number }) => Promise<CardSearchHit[]>>();
const getOfficialCard = vi.fn<(hit: CardSearchHit) => Promise<CardInfo | null>>();

vi.mock("../src/cards/cardSearch", async () => {
  const actual = await vi.importActual<typeof import("../src/cards/cardSearch")>("../src/cards/cardSearch");
  return {
    ...actual,
    searchOfficialCards: (keyword: string, options?: { maxResults?: number }) =>
      searchOfficialCards(keyword, options),
    getOfficialCard: (hit: CardSearchHit) => getOfficialCard(hit),
  };
});

const { findCardCandidates } = await import("../src/cards/cardNameMatcher");

function makeCard(overrides: Partial<CardInfo>): CardInfo {
  return {
    id: "id",
    url: "https://example.com",
    name: "カード",
    cardType: "クリーチャー",
    civilization: "水",
    rarity: "C",
    power: "1000",
    cost: "1",
    mana: "1",
    race: "",
    cardText: "",
    flavorText: "",
    illustrator: "",
    qaListUrl: null,
    ...overrides,
  };
}

describe("findCardCandidates のフォールバック挙動", () => {
  beforeEach(() => {
    searchOfficialCards.mockReset();
    getOfficialCard.mockReset();
  });

  it("primary検索が無関係な候補しか返さない場合、フォールバックトークンで再検索して正しいカードを見つける", async () => {
    // 公式サイト検索が「奇石 ミクセル / ジャミング・チャフ」というスラッシュ入りの
    // 複合カード名に対して0件ではなく無関係な候補を返す実際の挙動を再現する。
    searchOfficialCards.mockImplementation(async (keyword) => {
      if (keyword === "奇石 ミクセル / ジャミング・チャフ") {
        return [{ id: "unrelated-1", url: "u1" }];
      }
      if (keyword === "ジャミング") {
        return [{ id: "promoy24-108", url: "u2" }];
      }
      return [];
    });
    getOfficialCard.mockImplementation(async (hit) => {
      if (hit.id === "unrelated-1") {
        return makeCard({ id: "unrelated-1", name: "全く無関係なカード" });
      }
      if (hit.id === "promoy24-108") {
        return makeCard({ id: "promoy24-108", name: "奇石 ミクセル / ジャミング・チャフ", cost: "2" });
      }
      return null;
    });

    const matches = await findCardCandidates("奇石 ミクセル / ジャミング・チャフ");

    expect(matches[0]?.matchType).toBe("exact");
    expect(matches[0]?.card.id).toBe("promoy24-108");
    expect(matches[0]?.card.cost).toBe("2");
  });

  it("primary検索で十分な一致(閾値以上)が得られればフォールバック検索は行わない", async () => {
    searchOfficialCards.mockImplementation(async () => [{ id: "c1", url: "u1" }]);
    getOfficialCard.mockImplementation(async () => makeCard({ id: "c1", name: "斬隠蒼頭龍バイケン" }));

    await findCardCandidates("斬隠蒼頭龍バイケン");

    expect(searchOfficialCards).toHaveBeenCalledTimes(1);
  });
});
