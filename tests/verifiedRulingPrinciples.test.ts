import { describe, expect, it, vi } from "vitest";

const TEST_PRINCIPLES = [
  {
    id: "active-principle",
    title: "アクティブな原則",
    ruling: "テスト用のruling本文。",
    appliesWhen: ["条件A"],
    doesNotApplyWhen: ["条件B"],
    officialRuleIds: ["100.1"],
    officialQaUrls: [],
    triggerKeywords: ["置換効果"],
    verification: "official_rule",
    verifiedAt: "2026-09-02",
    status: "active",
  },
  {
    id: "deprecated-principle",
    title: "非推奨の原則",
    ruling: "非推奨のruling本文。",
    appliesWhen: ["条件C"],
    doesNotApplyWhen: [],
    officialRuleIds: ["100.2"],
    officialQaUrls: [],
    triggerKeywords: ["ブレイク"],
    verification: "official_rule",
    verifiedAt: "2026-09-02",
    status: "deprecated",
  },
  {
    id: "card-combo-principle",
    title: "カードの組み合わせで発火する原則",
    ruling: "テスト用のruling本文。",
    appliesWhen: ["条件D"],
    doesNotApplyWhen: [],
    officialRuleIds: ["100.3"],
    officialQaUrls: [],
    triggerKeywords: [],
    requiredCardNameGroups: [["カードA", "カードB"]],
    verification: "official_rule",
    verifiedAt: "2026-09-04",
    status: "active",
  },
];

vi.mock("../src/rules/data/verified-ruling-principles.json", () => ({ default: TEST_PRINCIPLES }));

const { searchVerifiedRulingPrinciples } = await import("../src/rules/verifiedRulingPrinciples");

describe("searchVerifiedRulingPrinciples", () => {
  it("正例: triggerKeywordsがruleConceptsに含まれる場合はヒットする", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: ["置換効果"], keywords: [], cardNames: [] });
    expect(results.map((p) => p.id)).toEqual(["active-principle"]);
  });

  it("正例: triggerKeywordsがkeywordsに含まれる場合もヒットする", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: [], keywords: ["置換効果"], cardNames: [] });
    expect(results.map((p) => p.id)).toEqual(["active-principle"]);
  });

  it("正例(2026-09-04追加): requiredCardNameGroupsの全カードがcardNamesに含まれる場合はヒットする", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: [], keywords: [], cardNames: ["カードA", "カードB"] });
    expect(results.map((p) => p.id)).toEqual(["card-combo-principle"]);
  });

  it("負例(2026-09-04追加): requiredCardNameGroupsの一部のカードしか無い場合はヒットしない(AND条件、OR条件ではない)", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: [], keywords: [], cardNames: ["カードA"] });
    expect(results.map((p) => p.id)).not.toContain("card-combo-principle");
  });

  it("負例(2026-09-04追加): カード名が1枚も一致しなければヒットしない", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: [], keywords: [], cardNames: ["無関係なカード"] });
    expect(results.map((p) => p.id)).not.toContain("card-combo-principle");
  });

  it("負例: 無関係な質問(トリガー語を含まない)には何もヒットしない", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: ["進化"], keywords: [], cardNames: [] });
    expect(results).toHaveLength(0);
  });

  it("status:deprecatedの原則はtriggerKeywordsが一致しても除外される", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: ["ブレイク"], keywords: [], cardNames: [] });
    expect(results).toHaveLength(0);
  });
});
