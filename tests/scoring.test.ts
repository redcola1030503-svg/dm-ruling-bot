import { describe, expect, it } from "vitest";
import { scoreTextMatch } from "../src/utils/scoring";

const RULE_603_3 =
  "603.3. 能力が誘発したら、効果は一度待機状態になり、その時点で待機している全ての効果のうちターン・プレイヤーのものから順番に処理をします。";

describe("scoreTextMatch のruleConcepts一致", () => {
  it("字面が異なっても意味的に近いruleConceptはスコアが付く(bigram overlap)", () => {
    const score = scoreTextMatch(RULE_603_3, {
      cardNames: [],
      ruleConcepts: ["ターンプレイヤーの優先権"],
      keywords: [],
    });
    expect(score).toBeGreaterThan(0);
  });

  it("短い語(3文字以下)の偶然の部分一致でスコアが付かない(ノイズ対策)", () => {
    // 「出た時」は603.3の文言には登場しないが、2-gramの偶然一致で
    // 誤検出しやすい短さのため、includes一致でない限りスコアを与えない。
    const score = scoreTextMatch(RULE_603_3, {
      cardNames: [],
      ruleConcepts: ["出た時"],
      keywords: [],
    });
    expect(score).toBe(0);
  });

  it("完全な部分文字列一致は引き続きスコアが付く", () => {
    const score = scoreTextMatch(RULE_603_3, {
      cardNames: [],
      ruleConcepts: ["ターン・プレイヤー"],
      keywords: [],
    });
    expect(score).toBeGreaterThan(0);
  });

  it("無関係な語にはスコアが付かない", () => {
    const score = scoreTextMatch(RULE_603_3, {
      cardNames: [],
      ruleConcepts: ["シールド"],
      keywords: [],
    });
    expect(score).toBe(0);
  });
});
