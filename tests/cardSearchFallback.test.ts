import { describe, expect, it, vi } from "vitest";

// cardSearch.ts はカード取得時にDB(node:sqlite)へ依存するモジュールを間接的に
// importするため、extractFallbackTokens(純粋関数)だけをテストする場合でも
// DB接続が発生しないようリポジトリ層をモックしておく。
vi.mock("../src/cards/cardRepository", () => ({
  getCachedCard: vi.fn(),
  saveCardToCache: vi.fn(),
}));

const { extractFallbackTokens } = await import("../src/cards/cardSearch");

describe("extractFallbackTokens", () => {
  it("英字とカタカナの境界でトークンを分割する", () => {
    const tokens = extractFallbackTokens("修羅の頂　VANベートーベン");
    expect(tokens).toContain("VAN");
    expect(tokens).toContain("ベートーベン");
    expect(tokens).toContain("修羅の頂");
  });

  it("元のキーワードそのものは候補に含めない", () => {
    const tokens = extractFallbackTokens("バイケン");
    expect(tokens).not.toContain("バイケン");
  });

  it("長いトークンを先に返す", () => {
    const tokens = extractFallbackTokens("修羅の頂　VANベートーベン");
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i - 1].length).toBeGreaterThanOrEqual(tokens[i].length);
    }
  });

  it("2文字未満のトークンは除外する", () => {
    const tokens = extractFallbackTokens("A ベートーベン");
    expect(tokens).not.toContain("A");
  });
});
