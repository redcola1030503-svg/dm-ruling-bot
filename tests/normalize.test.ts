import { describe, expect, it } from "vitest";
import { normalizeCardName } from "../src/utils/normalize";

describe("normalizeCardName", () => {
  it("空白(半角/全角)を除去する", () => {
    expect(normalizeCardName("修羅の頂 VANベートーベン")).toBe(
      normalizeCardName("修羅の頂　VANベートーベン"),
    );
  });

  it("中黒(・)を除去する", () => {
    expect(normalizeCardName("VAN・ベートーベン")).toBe(normalizeCardName("VANベートーベン"));
  });

  it("鉤括弧(「」『』)を除去する", () => {
    expect(normalizeCardName("「修羅」の頂 VAN・ベートーベン")).toBe(
      normalizeCardName("修羅の頂VANベートーベン"),
    );
  });

  it("大文字/小文字を区別しない", () => {
    expect(normalizeCardName("VAN")).toBe(normalizeCardName("van"));
  });

  it("アポストロフィの異体字(U+2019右シングルクォーテーション等)をU+0027に統一する", () => {
    // 「頂上混成 ガリュディアス・モモミーズ'22」のように、質問文側はASCIIアポストロフィ(U+0027)、
    // 公式カード名側はUnicode右シングルクォーテーション(U+2019)で表記されるケースがある。
    expect(normalizeCardName("ガリュディアス・モモミーズ'22")).toBe(
      normalizeCardName("ガリュディアス・モモミーズ’22"),
    );
    expect(normalizeCardName("ガリュディアス・モモミーズ‘22")).toBe(
      normalizeCardName("ガリュディアス・モモミーズ'22"),
    );
    expect(normalizeCardName("ガリュディアス・モモミーズ＇22")).toBe(
      normalizeCardName("ガリュディアス・モモミーズ'22"),
    );
  });
});
