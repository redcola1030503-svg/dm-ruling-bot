import { describe, expect, it } from "vitest";
import { extractRuleConcepts } from "../src/rules/ruleConceptDictionary";

describe("extractRuleConcepts", () => {
  it("質問文に含まれるルール用語を抽出する", () => {
    const question = "S・トリガーとブロッカーが同時に誘発する場合はどうなりますか？";
    expect(extractRuleConcepts(question)).toEqual(["S・トリガー", "同時", "ブロッカー"]);
  });

  it("該当なしの場合は空配列を返す", () => {
    expect(extractRuleConcepts("こんにちは")).toEqual([]);
  });
});
