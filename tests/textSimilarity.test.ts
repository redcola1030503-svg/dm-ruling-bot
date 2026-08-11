import { describe, expect, it } from "vitest";
import { bigramOverlap, levenshteinDistance, similarityScore } from "../src/utils/textSimilarity";

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

describe("bigramOverlap", () => {
  it("言い回しが違っても意味的に近い場合は高いoverlapになる", () => {
    const result = bigramOverlap(
      "ターンプレイヤーの優先権",
      "603.3能力が誘発したら効果は一度待機状態になりその時点で待機している全ての効果のうちターンプレイヤーのものから順番に処理をします",
    );
    expect(result.ratio).toBeGreaterThanOrEqual(0.6);
    expect(result.commonCount).toBeGreaterThanOrEqual(2);
  });

  it("無関係な文章とは低いoverlapになる", () => {
    const result = bigramOverlap(
      "ターンプレイヤーの優先権",
      "デュエルマスターズは2人のプレイヤーがそれぞれ自分のデッキを使い対戦するカードゲームです",
    );
    expect(result.ratio).toBeLessThan(0.6);
  });

  it("空文字はoverlap 0", () => {
    expect(bigramOverlap("", "何か文章")).toEqual({ ratio: 0, commonCount: 0 });
  });
});
