import { describe, expect, it } from "vitest";
import { formatRulingForLine } from "../src/line/formatRuling";
import type { RulingResult } from "../src/ruling/types";

const BASE_RESULT: RulingResult = {
  conclusion: "S・トリガーは使えません。",
  explanation: "置換効果によりシールドは墓地に置かれるため、通常のS・トリガー処理には入りません。",
  steps: ["シールドをブレイク", "置換効果を適用", "シールドを墓地へ置く", "S・トリガーは使用不可"],
  confidence: "high",
  cards: ["ボルメテウス・ホワイト・ドラゴン"],
  sources: [{ title: "公式Q&A", url: "https://dm.takaratomy.co.jp/rule/qa/12345/" }],
};

describe("formatRulingForLine", () => {
  it("結論・理由・処理順・確度・公式情報を含む", () => {
    const text = formatRulingForLine(BASE_RESULT);
    expect(text).toContain("【結論】");
    expect(text).toContain("S・トリガーは使えません。");
    expect(text).toContain("【理由】");
    expect(text).toContain("【処理順】");
    expect(text).toContain("①");
    expect(text).toContain("確度：高");
    expect(text).toContain("【根拠】");
    expect(text).toContain("https://dm.takaratomy.co.jp/rule/qa/12345/");
  });

  it("sourcesが空の場合は【根拠】セクションを省略する", () => {
    const text = formatRulingForLine({ ...BASE_RESULT, sources: [] });
    expect(text).not.toContain("【根拠】");
  });

  it("urlが空文字の場合(過去の訂正事例)はタイトルのみ表示しURL行は出さない", () => {
    const text = formatRulingForLine({
      ...BASE_RESULT,
      sources: [{ title: "過去の訂正事例(ジャッジID: J001)", url: "" }],
    });
    expect(text).toContain("・過去の訂正事例(ジャッジID: J001)");
  });

  it("sourcesは最大5件に制限される", () => {
    const manySources = Array.from({ length: 8 }, (_, i) => ({
      title: `情報${i}`,
      url: `https://example.com/${i}`,
    }));
    const text = formatRulingForLine({ ...BASE_RESULT, sources: manySources });
    expect(text).toContain("https://example.com/4");
    expect(text).not.toContain("https://example.com/5");
  });
});
