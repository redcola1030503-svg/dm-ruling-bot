import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../src/search/similarity";

describe("cosineSimilarity", () => {
  it("同一vectorはほぼ1になる", () => {
    const a = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it("直交するvectorはほぼ0になる", () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("正反対のvectorはほぼ-1になる", () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("次元数が異なる場合はエラーを投げる", () => {
    const a = Float32Array.from([1, 0]);
    const b = Float32Array.from([1, 0, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow();
  });

  it("ゼロベクトルとの類似度は0", () => {
    const a = Float32Array.from([0, 0, 0]);
    const b = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});
