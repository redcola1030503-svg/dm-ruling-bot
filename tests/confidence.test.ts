import { describe, expect, it } from "vitest";
import { estimateConfidence, pickMoreCautious } from "../src/ruling/confidence";
import type { RulingEvidence } from "../src/ruling/types";

const EMPTY_EVIDENCE: RulingEvidence = {
  cards: [],
  qa: [],
  ruleChanges: [],
  generalRules: [],
  pastCorrections: [],
  keywordAbilities: [],
  verifiedRulingPrinciples: [],
  ambiguousCards: [],
};

describe("pickMoreCautious", () => {
  it("lowとhighならlowを返す", () => {
    expect(pickMoreCautious("low", "high")).toBe("low");
    expect(pickMoreCautious("high", "low")).toBe("low");
  });

  it("mediumとhighならmediumを返す", () => {
    expect(pickMoreCautious("medium", "high")).toBe("medium");
  });

  it("同じ値ならその値を返す", () => {
    expect(pickMoreCautious("high", "high")).toBe("high");
  });
});

describe("estimateConfidence", () => {
  it("訂正事例が強くスコア一致(score>=10)する場合はhigh(公式Q&A・総合ルールと同格)", () => {
    const evidence: RulingEvidence = {
      ...EMPTY_EVIDENCE,
      pastCorrections: [
        {
          title: "過去の訂正事例(公認ジャッジによる記録)",
          text: "...",
          url: "",
          sourceType: "correction",
          itemKey: "1",
          score: 12,
        },
      ],
    };
    expect(estimateConfidence(evidence)).toBe("high");
  });

  it("訂正事例のスコアが弱くてもカードテキストがあればmedium", () => {
    const evidence: RulingEvidence = {
      ...EMPTY_EVIDENCE,
      cards: [
        {
          title: "カード",
          text: "...",
          url: "https://example.com/card",
          sourceType: "card",
          itemKey: "card-1",
        },
      ],
      pastCorrections: [
        {
          title: "過去の訂正事例",
          text: "...",
          url: "",
          sourceType: "correction",
          itemKey: "2",
          score: 1,
        },
      ],
    };
    expect(estimateConfidence(evidence)).toBe("medium");
  });

  it("訂正事例もカードもQ&Aも総合ルールも無ければlow", () => {
    expect(estimateConfidence(EMPTY_EVIDENCE)).toBe("low");
  });

  it("検証済み裁定原則(D-006)がヒットしていてもカードテキストがなければlow", () => {
    const evidence: RulingEvidence = {
      ...EMPTY_EVIDENCE,
      verifiedRulingPrinciples: [
        {
          title: "複数の置換効果が異なるイベントに適用される場合の決定順",
          text: "...",
          url: "",
          sourceType: "verifiedRulingPrinciple",
          itemKey: "replacement-effect-order-multiple-events",
        },
      ],
    };
    expect(estimateConfidence(evidence)).toBe("low");
  });

  it("検証済み裁定原則(D-006)がヒットしカードテキストもあればmedium(highにはしない)", () => {
    const evidence: RulingEvidence = {
      ...EMPTY_EVIDENCE,
      cards: [
        {
          title: "カード",
          text: "...",
          url: "https://example.com/card",
          sourceType: "card",
          itemKey: "card-1",
        },
      ],
      verifiedRulingPrinciples: [
        {
          title: "複数の置換効果が異なるイベントに適用される場合の決定順",
          text: "...",
          url: "",
          sourceType: "verifiedRulingPrinciple",
          itemKey: "replacement-effect-order-multiple-events",
        },
      ],
    };
    expect(estimateConfidence(evidence)).toBe("medium");
  });
});
