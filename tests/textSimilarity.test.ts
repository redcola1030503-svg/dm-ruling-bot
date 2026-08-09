import { describe, expect, it } from "vitest";
import { levenshteinDistance, similarityScore } from "../src/utils/textSimilarity";

describe("levenshteinDistance", () => {
  it("同じ文字列は距離0", () => {
    expect(levenshteinDistance("ボルメテウス", "ボルメテウス")).toBe(0);
  });

  it("1文字異なる場合は距離1", () => {
    expect(levenshteinDistance("ボルメテウス", "ボルメテウズ")).toBe(1);
  });
});

describe("similarityScore", () => {
  it("完全一致は1.0", () => {
    expect(similarityScore("ボルホワ", "ボルホワ")).toBe(1);
  });

  it("空文字同士は1.0", () => {
    expect(similarityScore("", "")).toBe(1);
  });

  it("大きく異なる文字列は低いスコアになる", () => {
    expect(similarityScore("ボルメテウス", "全く違う文字列です")).toBeLessThan(0.3);
  });
});
