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

  it("区切り記号・表記体系境界のどちらでも分割できない語は、先頭を短縮したprefix候補を追加する", () => {
    const tokens = extractFallbackTokens("セイントキャッスル");
    expect(tokens).toContain("セイント");
    expect(tokens).toContain("セイントキャッス");
    // 短縮しすぎた候補(2文字以下)は含めない
    expect(tokens).not.toContain("セ");
    expect(tokens).not.toContain("セイ");
  });

  it("表記体系境界で複数語に分割できる場合はprefix短縮を適用しない(既に分割済みのため不要)", () => {
    const tokens = extractFallbackTokens("修羅の頂　VANベートーベン");
    expect(tokens).not.toContain("ベートーベ");
    expect(tokens).not.toContain("VA");
  });
});
