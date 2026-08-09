import { describe, expect, it } from "vitest";
import {
  hasNextPage,
  parseRuleChangeDetailPage,
  parseRuleChangeListPage,
} from "../src/rules/ruleChangeParser";

const LIST_HTML = `
<ul class="newsList03">
<li><p class='tit01'><a href='/rule/rulechange/316685/' class='popup_rulechange'>一部FAQの回答変更のお知らせ</a></p><p class='day01'>2026.7.9</p></li>
<li><p class='tit01'><a href='/rule/rulechange/316681/' class='popup_rulechange'>《聖霊王アルカディアス》のテキスト不備とお詫びに関して</a></p><p class='day01'>2026.4.3</p></li>
</ul>
<div class="wp-pagenavi">
<div class='wp-pagenavi' role='navigation'>
<span aria-current='page' class='current'>1</span>
<a class="page larger" href="/rule/rulechange/change/page/2/">2</a>
<a class="nextpostslink" rel="next" href="/rule/rulechange/change/page/2/">»</a>
</div>
</div>
`;

const LAST_PAGE_HTML = `
<ul class="newsList03">
<li><p class='tit01'><a href='/rule/rulechange/31663/' class='popup_rulechange'>《龍装者 バルチュリス》のテキスト不備とお詫びに関して</a></p><p class='day01'>2022.10.21</p></li>
</ul>
<div class="wp-pagenavi">
<div class='wp-pagenavi' role='navigation'>
<a class="page larger" href="/rule/rulechange/change/page/3/">3</a>
<span aria-current='page' class='current'>4</span>
</div>
</div>
`;

const DETAIL_HTML = `
<h1 class="h1_basic01 fontTbu"><span>《聖霊王アルカディアス》 (P16/Y25)のテキスト不備とお詫びに関して</span></h1>
<section class="sectionFormat01 sectionMargin01">
  <div class="sectionIn01">
    <p style="text-align: right">掲載日：2026年4月3日</p>
    <p>対象カード：≪聖霊王アルカディアス≫ (P16/Y25)<br>パワーに不備がありました。</p>
  </div>
</section>
`;

describe("parseRuleChangeListPage", () => {
  it("一覧からid/url/タイトル/日付を抽出する", () => {
    const items = parseRuleChangeListPage(LIST_HTML);
    expect(items).toEqual([
      {
        id: "316685",
        url: "https://dm.takaratomy.co.jp/rule/rulechange/316685/",
        title: "一部FAQの回答変更のお知らせ",
        date: "2026.7.9",
      },
      {
        id: "316681",
        url: "https://dm.takaratomy.co.jp/rule/rulechange/316681/",
        title: "《聖霊王アルカディアス》のテキスト不備とお詫びに関して",
        date: "2026.4.3",
      },
    ]);
  });
});

describe("hasNextPage", () => {
  it("次ページリンクがあればtrue", () => {
    expect(hasNextPage(LIST_HTML)).toBe(true);
  });

  it("最終ページではfalse", () => {
    expect(hasNextPage(LAST_PAGE_HTML)).toBe(false);
  });
});

describe("parseRuleChangeDetailPage", () => {
  it("タイトルと本文を抽出する", () => {
    const detail = parseRuleChangeDetailPage(
      DETAIL_HTML,
      "316681",
      "https://dm.takaratomy.co.jp/rule/rulechange/316681/",
    );
    expect(detail?.title).toBe("《聖霊王アルカディアス》 (P16/Y25)のテキスト不備とお詫びに関して");
    expect(detail?.date).toBe("2026年4月3日");
    expect(detail?.body).toContain("対象カード：≪聖霊王アルカディアス≫");
  });
});
