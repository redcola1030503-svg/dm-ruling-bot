import { describe, expect, it } from "vitest";
import { parseKeywordAbilityPage } from "../src/rules/dmwikiParser";

const SAMPLE_HTML = `
<html>
<body>
<div id="navigator">サイト内検索</div>
<div id="body">
<h2 id="content_1_0">サンプル能力</h2>
<p>これは定義文です。</p>
<h3 id="content_1_1">ルール</h3>
<p>これはルール説明です。</p>
<h3 id="content_1_2">テクニック</h3>
<p>これは戦術解説であり含まれてはいけません。</p>
<h3 id="content_1_3">サンプル能力の一覧</h3>
<p>カード一覧であり含まれてはいけません。</p>
</div>
</body>
</html>
`;

describe("parseKeywordAbilityPage", () => {
  it("定義文とルール説明を抽出し、テクニック以降は除外する", () => {
    const result = parseKeywordAbilityPage(SAMPLE_HTML);
    expect(result).toContain("これは定義文です。");
    expect(result).toContain("これはルール説明です。");
    expect(result).not.toContain("戦術解説");
    expect(result).not.toContain("カード一覧");
  });

  it("#bodyが無い場合はnullを返す", () => {
    expect(parseKeywordAbilityPage("<html><body>本文なし</body></html>")).toBeNull();
  });

  it("本文が空の場合はnullを返す", () => {
    const html = `<div id="body"><h2 id="content_1_0">タイトルのみ</h2></div>`;
    expect(parseKeywordAbilityPage(html)).toBeNull();
  });
});
