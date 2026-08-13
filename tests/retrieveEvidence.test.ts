import { describe, expect, it, vi } from "vitest";
import type { CardInfo } from "../src/cards/types";
import type { CardNameMatch } from "../src/cards/cardNameMatcher";

vi.mock("../src/rules/qaRanking", () => ({ searchAndRankQa: vi.fn().mockResolvedValue([]) }));
vi.mock("../src/rules/ruleChangeRanking", () => ({
  searchAndRankRuleChanges: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/search/hybridSearch", () => ({
  hybridSearchGeneralRules: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/corrections/ranking", () => ({ searchAndRankCorrections: vi.fn().mockReturnValue([]) }));

const findCardCandidates = vi.fn<(name: string) => Promise<CardNameMatch[]>>();
vi.mock("../src/cards/cardNameMatcher", () => ({
  findCardCandidates: (name: string) => findCardCandidates(name),
}));

const { retrieveEvidence } = await import("../src/ruling/retrieveEvidence");

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

function makeParsedQuestion(cardNames: string[]) {
  return {
    originalText: cardNames.join(" "),
    cardNames,
    keywords: [],
    ruleConcepts: [],
    situation: "",
    question: "",
  };
}

describe("retrieveEvidence のカード名あいまい判定", () => {
  it("exact一致のみの場合は確定してcardsに含める", async () => {
    findCardCandidates.mockResolvedValueOnce([
      { card: makeCard({ id: "a", name: "斬隠蒼頭龍バイケン" }), matchType: "exact", score: 1 },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["斬隠蒼頭龍バイケン"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
    expect(evidence.cards[0].title).toBe("斬隠蒼頭龍バイケン");
  });

  it("prefix一致で他に閾値超えの候補がなければ確定する", async () => {
    findCardCandidates.mockResolvedValueOnce([
      { card: makeCard({ id: "a", name: "勝熱英雄 モモキング" }), matchType: "prefix", score: 0.9 },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["勝熱英雄"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
  });

  it("prefix一致でも他に閾値超えの別カードが並ぶ場合はあいまい判定にする", async () => {
    findCardCandidates.mockResolvedValueOnce([
      { card: makeCard({ id: "a", name: "ベートーベン・キューブ" }), matchType: "prefix", score: 0.9 },
      {
        card: makeCard({ id: "b", name: "「修羅」の頂 VAN・ベートーベン" }),
        matchType: "partial",
        score: 0.75,
      },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["ベートーベン"]));

    expect(evidence.cards).toHaveLength(0);
    expect(evidence.ambiguousCards).toEqual([
      {
        queried: "ベートーベン",
        candidates: ["ベートーベン・キューブ", "「修羅」の頂 VAN・ベートーベン"],
      },
    ]);
  });

  it("候補が0件の場合はambiguousCardsに追加しない(裁定生成側に委ねる)", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["存在しないカード"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(0);
  });

  it("フルネームでexact一致していれば、同じカードの略称側もあいまい判定にしない", async () => {
    const fullNameMatch: CardNameMatch = {
      card: makeCard({ id: "baiken", name: "斬隠蒼頭龍バイケン" }),
      matchType: "exact",
      score: 1,
    };
    const abbreviatedMatches: CardNameMatch[] = [
      { card: makeCard({ id: "other", name: "バイケンの海幻" }), matchType: "prefix", score: 0.9 },
      { card: makeCard({ id: "baiken", name: "斬隠蒼頭龍バイケン" }), matchType: "partial", score: 0.75 },
    ];
    findCardCandidates.mockResolvedValueOnce([fullNameMatch]);
    findCardCandidates.mockResolvedValueOnce(abbreviatedMatches);

    const evidence = await retrieveEvidence(makeParsedQuestion(["斬隠蒼頭龍バイケン", "バイケン"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
    expect(evidence.cards[0].title).toBe("斬隠蒼頭龍バイケン");
  });
});
