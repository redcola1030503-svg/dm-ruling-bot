import { describe, expect, it, vi } from "vitest";
import type { CardFace, CardInfo, CardSearchHit } from "../src/cards/types";

const searchOfficialCards = vi.fn<(keyword: string) => Promise<CardSearchHit[]>>();
const getOfficialCard = vi.fn<(hit: CardSearchHit) => Promise<CardInfo | null>>();
vi.mock("../src/cards/cardSearch", () => ({
  searchOfficialCards: (keyword: string) => searchOfficialCards(keyword),
  getOfficialCard: (hit: CardSearchHit) => getOfficialCard(hit),
}));

const { findCardCandidates } = await import("../src/cards/cardNameMatcher");

const PRIMARY_FACE: CardFace = {
  name: "時空の英雄アンタッチャブル",
  cardType: "サイキック・クリーチャー",
  civilization: "光",
  rarity: "VR",
  power: "5000",
  cost: "5",
  mana: "0",
  race: "キカイヒーロー",
};

const ALT_FACE: CardFace = {
  name: "変幻の覚醒者アンタッチャブル・パワード",
  cardType: "サイキック・クリーチャー",
  civilization: "水",
  rarity: "VR",
  power: "6000",
  cost: "0",
  mana: "0",
  race: "サイバー・コマンド",
};

function makeCard(overrides: Partial<CardInfo>): CardInfo {
  return {
    id: "id",
    url: "https://example.com",
    name: PRIMARY_FACE.name,
    alternateNames: [ALT_FACE.name],
    cardType: PRIMARY_FACE.cardType,
    civilization: PRIMARY_FACE.civilization,
    rarity: PRIMARY_FACE.rarity,
    power: PRIMARY_FACE.power,
    cost: PRIMARY_FACE.cost,
    mana: PRIMARY_FACE.mana,
    race: PRIMARY_FACE.race,
    cardText: "",
    flavorText: "",
    illustrator: "",
    qaListUrl: null,
    faces: [PRIMARY_FACE, ALT_FACE],
    ...overrides,
  };
}

describe("findCardCandidates の複数面カード(サイキック/ドラグハート等)対応", () => {
  it("主要名(name)での入力はexact一致し、matchedFaceは主要面になる", async () => {
    searchOfficialCards.mockResolvedValueOnce([{ id: "a", url: "https://example.com/a" }]);
    getOfficialCard.mockResolvedValueOnce(makeCard({}));

    const matches = await findCardCandidates("時空の英雄アンタッチャブル");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchType).toBe("exact");
    expect(matches[0]?.score).toBe(1);
    expect(matches[0]?.matchedFace).toEqual(PRIMARY_FACE);
  });

  it("別名(裏面)での入力もexact一致し、matchedFaceは裏面の属性になる(誤った表面属性を渡さない)", async () => {
    searchOfficialCards.mockResolvedValueOnce([{ id: "a", url: "https://example.com/a" }]);
    getOfficialCard.mockResolvedValueOnce(makeCard({}));

    const matches = await findCardCandidates("変幻の覚醒者アンタッチャブル・パワード");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchType).toBe("exact");
    expect(matches[0]?.score).toBe(1);
    expect(matches[0]?.matchedFace).toEqual(ALT_FACE);
  });

  it("name・alternateNamesのどちらとも一致しない場合はヒットしない", async () => {
    searchOfficialCards.mockResolvedValueOnce([{ id: "a", url: "https://example.com/a" }]);
    getOfficialCard.mockResolvedValueOnce(makeCard({}));

    const matches = await findCardCandidates("全く無関係なカード名");

    expect(matches).toHaveLength(0);
  });
});
