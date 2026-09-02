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

  it("D-006: 攻撃/ブロック指定持続の原則が対象とする自然な言い回しの活用ゆれを拾う", () => {
    expect(extractRuleConcepts("このクリーチャーは攻撃できなくなりますか？")).toContain("攻撃できな");
    expect(extractRuleConcepts("ブロックできなかった場合はどうなりますか？")).toContain("ブロックできな");
    expect(extractRuleConcepts("攻撃に参加できなくなった場合の処理を教えてください")).toContain("参加できな");
  });
});
