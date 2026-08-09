import { describe, expect, it } from "vitest";
import { extractGeneralRulePdfUrl, splitIntoRuleChunks } from "../src/rules/generalRuleParser";

const PAGE_HTML = `
<a href="/img/dm_rule_20260723_5.pdf">デュエル・マスターズ総合ゲームルール　Ver.1.51 （PDF形式） （最終更新日2026/07/23）</a>
<a href="/img/dm_competition_rule_20250501.pdf">デュエル・マスターズ 競技イベント運営ルール（PDF形式）</a>
`;

describe("extractGeneralRulePdfUrl", () => {
  it("「総合ゲームルール」のPDFリンクを抽出する", () => {
    expect(extractGeneralRulePdfUrl(PAGE_HTML)).toBe(
      "https://dm.takaratomy.co.jp/img/dm_rule_20260723_5.pdf",
    );
  });

  it("該当リンクがない場合はnullを返す", () => {
    expect(extractGeneralRulePdfUrl("<a href='/img/other.pdf'>その他</a>")).toBeNull();
  });
});

describe("splitIntoRuleChunks", () => {
  it("条文番号ごとにテキストを分割する", () => {
    const text = `609. 置換効果
609.4. イベントが置換された場合、それは決して起こったことにはなりません。
609.5. 置換効果があるイベントを置換する場合、そのイベントが発生しなければ、置換効果
は何もしません。
609.6. 置換効果の中に、カードを引くことを置換するものがあります。`;

    const chunks = splitIntoRuleChunks(text);
    const chunk609_5 = chunks.find((c) => c.ruleNumber === "609.5");
    expect(chunk609_5?.text).toContain("そのイベントが発生しなければ、置換効果 は何もしません。");
  });

  it("短すぎる断片は除外する", () => {
    const chunks = splitIntoRuleChunks("609. \n609.1. a");
    expect(chunks.every((c) => c.text.length >= 5)).toBe(true);
  });
});
