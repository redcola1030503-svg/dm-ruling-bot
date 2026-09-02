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
];

vi.mock("../src/rules/data/verified-ruling-principles.json", () => ({ default: TEST_PRINCIPLES }));

const { searchVerifiedRulingPrinciples } = await import("../src/rules/verifiedRulingPrinciples");

describe("searchVerifiedRulingPrinciples", () => {
  it("正例: triggerKeywordsがruleConceptsに含まれる場合はヒットする", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: ["置換効果"], keywords: [] });
    expect(results.map((p) => p.id)).toEqual(["active-principle"]);
  });

  it("正例: triggerKeywordsがkeywordsに含まれる場合もヒットする", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: [], keywords: ["置換効果"] });
    expect(results.map((p) => p.id)).toEqual(["active-principle"]);
  });

  it("負例: 無関係な質問(トリガー語を含まない)には何もヒットしない", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: ["進化"], keywords: [] });
    expect(results).toHaveLength(0);
  });

  it("status:deprecatedの原則はtriggerKeywordsが一致しても除外される", () => {
    const results = searchVerifiedRulingPrinciples({ ruleConcepts: ["ブレイク"], keywords: [] });
    expect(results).toHaveLength(0);
  });
});
