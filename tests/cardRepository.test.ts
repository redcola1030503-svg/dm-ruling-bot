import { describe, expect, it, vi } from "vitest";
import type { CardInfo } from "../src/cards/types";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { getCachedCard, saveCardToCache } = await import("../src/cards/cardRepository");

const FACES = [
  {
    name: "時空の英雄アンタッチャブル",
    cardType: "サイキック・クリーチャー",
    civilization: "光",
    rarity: "VR",
    power: "5000",
    cost: "5",
    mana: "0",
    race: "キカイヒーロー",
  },
  {
    name: "変幻の覚醒者アンタッチャブル・パワード",
    cardType: "サイキック・クリーチャー",
    civilization: "水",
    rarity: "VR",
    power: "6000",
    cost: "0",
    mana: "0",
    race: "サイバー・コマンド",
  },
];

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
    faces: FACES,
    ...overrides,
  };
}

describe("cards/cardRepository の faces 往復", () => {
  it("saveCardToCache: facesをJSON文字列化してINSERTする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    saveCardToCache(makeCard({}));

    expect(runFn).toHaveBeenCalledWith(
      "dm37-021",
      "時空の英雄アンタッチャブル",
      "https://example.com/dm37-021",
      "サイキック・クリーチャー",
      "光",
      "VR",
      "5000",
      "5",
      "0",
      "キカイヒーロー",
      "W・ブレイカー",
      "",
      "",
      null,
      JSON.stringify(FACES),
      expect.any(Number),
    );
  });

  it("getCachedCard: facesのJSON文字列を復元し、alternateNamesをfaces[1:]から導出する", () => {
    prepareMock.mockReturnValue({
      get: vi.fn().mockReturnValue({
        id: "dm37-021",
        name: "時空の英雄アンタッチャブル",
        url: "https://example.com/dm37-021",
        card_type: "サイキック・クリーチャー",
        civilization: "光",
        rarity: "VR",
        power: "5000",
        cost: "5",
        mana: "0",
        race: "キカイヒーロー",
        card_text: "W・ブレイカー",
        flavor_text: "",
        illustrator: "",
        qa_list_url: null,
        faces: JSON.stringify(FACES),
        updated_at: Date.now(),
      }),
    });

    const card = getCachedCard("dm37-021");

    expect(card?.faces).toEqual(FACES);
    expect(card?.alternateNames).toEqual(["変幻の覚醒者アンタッチャブル・パワード"]);
  });

  it("getCachedCard: facesがnull(旧スキーマ)の場合は主要面のみのfacesへフォールバックする", () => {
    prepareMock.mockReturnValue({
      get: vi.fn().mockReturnValue({
        id: "dm26ex3-005",
        name: "テストカード",
        url: "https://example.com/dm26ex3-005",
        card_type: "クリーチャー",
        civilization: "水",
        rarity: "C",
        power: "1000",
        cost: "1",
        mana: "1",
        race: "",
        card_text: "",
        flavor_text: "",
        illustrator: "",
        qa_list_url: null,
        faces: null,
        updated_at: Date.now(),
      }),
    });

    const card = getCachedCard("dm26ex3-005");

    expect(card?.alternateNames).toEqual([]);
    expect(card?.faces).toEqual([
      {
        name: "テストカード",
        cardType: "クリーチャー",
        civilization: "水",
        rarity: "C",
        power: "1000",
        cost: "1",
        mana: "1",
        race: "",
      },
    ]);
  });

  it("getCachedCard: ツインパクト等、両面の名前が同一表記のfacesを復元すると、alternateNamesは空になる(主要名との重複を除く不変条件がキャッシュ往復でも保たれる)", () => {
    const twinpactFace = {
      name: "パルフェ・ルピア / 「あとはたのんだぞ」",
      cardType: "クリーチャー",
      civilization: "光",
      rarity: "C",
      power: "1000",
      cost: "3",
      mana: "3",
      race: "",
    };
    const spellFace = { ...twinpactFace, cardType: "呪文" };
    prepareMock.mockReturnValue({
      get: vi.fn().mockReturnValue({
        id: "dm26ex2-017",
        name: twinpactFace.name,
        url: "https://example.com/dm26ex2-017",
        card_type: twinpactFace.cardType,
        civilization: twinpactFace.civilization,
        rarity: twinpactFace.rarity,
        power: twinpactFace.power,
        cost: twinpactFace.cost,
        mana: twinpactFace.mana,
        race: twinpactFace.race,
        card_text: "ブロッカー\n---\n次の中から1回選ぶ。",
        flavor_text: "",
        illustrator: "",
        qa_list_url: null,
        faces: JSON.stringify([twinpactFace, spellFace]),
        updated_at: Date.now(),
      }),
    });

    const card = getCachedCard("dm26ex2-017");

    expect(card?.alternateNames).toEqual([]);
  });
});
