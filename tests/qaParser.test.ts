import { describe, expect, it } from "vitest";
import { parseCardQaListPage, parseQaDetailPage, parseQaListPage } from "../src/rules/qaParser";

const LIST_HTML = `
<div id="qa_result_area" class="loading_wrap">
<ul class="newsList03"><li>
    <form action="https://dm.takaratomy.co.jp/rule/qa/48941/" method="post">
        <p class="tit01"><a href="https://dm.takaratomy.co.jp/rule/qa/48941/">《熱血の名 修羅丸》のテキスト不備について</a></p>
        <p class="day01">2026.6.12</p>
    </form>
</li>
<li>
    <form action="https://dm.takaratomy.co.jp/rule/qa/48467/" method="post">
        <p class="tit01"><a href="https://dm.takaratomy.co.jp/rule/qa/48467/">ハイパーモードについて</a></p>
        <p class="day01">2026.4.10</p>
    </form>
</li>
</ul>
</div>
`;

const NO_RESULT_HTML = `
<div id="qa_result_area" class="loading_wrap">
<p>該当する質問が見つかりませんでした。条件を変更してお試しください。</p></div>
`;

const DETAIL_HTML = `
<form action="/rule/qa/" method="post" class="qabox01">
  <div class="question">
    <h2><span class="qabox01_hl01">Q</span>《熱血の名 修羅丸》の効果について教えてください。</h2>
  </div>
  <div class="answer"><span class="qabox01_hl01">A</span>いいえ、残せません。</div>
</form>
`;

describe("parseQaListPage", () => {
  it("Q&A一覧からid/url/タイトル/日付を抽出する", () => {
    const items = parseQaListPage(LIST_HTML);
    expect(items).toEqual([
      {
        id: "48941",
        url: "https://dm.takaratomy.co.jp/rule/qa/48941/",
        titleText: "《熱血の名 修羅丸》のテキスト不備について",
        date: "2026.6.12",
      },
      {
        id: "48467",
        url: "https://dm.takaratomy.co.jp/rule/qa/48467/",
        titleText: "ハイパーモードについて",
        date: "2026.4.10",
      },
    ]);
  });

  it("該当なしの場合は空配列を返す", () => {
    expect(parseQaListPage(NO_RESULT_HTML)).toEqual([]);
  });
});

const CARD_QA_LIST_HTML = `
<div class="sectionIn01 sectionMargin02 list "><h3 class="subTitle fontTbu"><span>関連する質問</span></h3><ul class="newsList03">
<li>
    <p class="tit01"><a href="https://dm.takaratomy.co.jp/rule/qa/49076/">《世界竜皇 ボルシャック・ヒカリスマ》の能力で見た２枚の中に《パルフェ・ルピア》がありました。</a></p>
    <p class="day01">2026.7.17</p>
</li>
</ul>
</div>
`;

describe("parseCardQaListPage", () => {
  it("カード詳細ページの「このカードのよくある質問」一覧を抽出する", () => {
    const items = parseCardQaListPage(CARD_QA_LIST_HTML);
    expect(items).toEqual([
      {
        id: "49076",
        url: "https://dm.takaratomy.co.jp/rule/qa/49076/",
        titleText: "《世界竜皇 ボルシャック・ヒカリスマ》の能力で見た２枚の中に《パルフェ・ルピア》がありました。",
        date: "2026.7.17",
      },
    ]);
  });
});

describe("parseQaDetailPage", () => {
  it("Q/Aの本文からラベルを除いたテキストを抽出する", () => {
    const detail = parseQaDetailPage(
      DETAIL_HTML,
      "48941",
      "https://dm.takaratomy.co.jp/rule/qa/48941/",
    );
    expect(detail).toEqual({
      id: "48941",
      url: "https://dm.takaratomy.co.jp/rule/qa/48941/",
      question: "《熱血の名 修羅丸》の効果について教えてください。",
      answer: "いいえ、残せません。",
    });
  });

  it(".qabox01がない場合はnullを返す", () => {
    expect(parseQaDetailPage("<div></div>", "x", "https://example.com")).toBeNull();
  });
});
