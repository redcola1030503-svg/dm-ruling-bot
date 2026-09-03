import { describe, expect, it } from "vitest";
import { parseCardDetailPage, parseCardListPage, parseTotalCount } from "../src/cards/cardParser";

const LIST_HTML = `
<div id="cardlist">
  <ul class="cardList01 clearfix">
    <li><a href="/card/detail/?id=dm26ex3-SEC001"><img class="cardImage" src="/cardimage/dm26ex3-SEC001a.jpg?x=1" alt=" "></a></li>
    <li><a href="/card/detail/?id=dm26ex3-SEC001CHO"><img class="cardImage" src="/cardimage/dm26ex3-SEC001CHOa.jpg?x=1" alt=" "></a></li>
    <li><a href="/card/detail/?id=dm26ex3-SEC001"><img class="cardImage" src="/cardimage/dup.jpg" alt=" "></a></li>
  </ul>
</div>
<span id="total_count">23310枚</span>
`;

const DETAIL_HTML = `
<div class="cardDetail">
  <div class="card-itself">
    <div class="row"><div class="small-12 columns">
      <h3 class="card-name">ボルメテウス・ホワイト・ドラゴン<span class="packname">(SET1 1/100)</span></h3>
    </div></div>
    <table><tbody><tr>
      <th>カードの種類</th><td class="type">クリーチャー</td>
      <th>文明</th><td class="civil">火</td>
    </tr></tbody></table>
    <table><tbody><tr>
      <th>レアリティ</th><td class="rarelity">SR</td>
      <th>パワー</th><td class="power">7000</td>
    </tr></tbody></table>
    <table><tbody><tr>
      <th>コスト</th><td class="cost">7</td>
      <th>マナ</th><td class="mana">1</td>
    </tr></tbody></table>
    <table><tbody><tr>
      <th>種族</th><td class="race">アーマード・ドラゴン</td>
    </tr></tbody></table>
    <table><tbody><tr>
      <th class="illusttitle">イラストレーター</th><td class="illusttxt">Shigenobu Matsumoto</td>
    </tr></tbody></table>
    <table><tbody>
      <tr><th class="full">特殊能力</th></tr>
      <tr><td class="skills full">W・ブレイカー このクリーチャーがシールドをブレイクする時、相手はそのシールドを手札に加えるかわりに墓地に置く。</td></tr>
    </tbody></table>
    <table><tbody>
      <tr><th class="full">フレーバー</th></tr>
      <tr><td class="flavor full"></td></tr>
    </tbody></table>
  </div>
</div>
<input type="hidden" id="qa_url" value="https://dm.takaratomy.co.jp/rule/qa/49228/">
`;

const PSYCHIC_DETAIL_HTML = `
<div class="cardDetail">
  <div class="card-itself">
    <h3 class="card-name">時空の英雄アンタッチャブル<span class="packname">(DM37 21/95)</span></h3>
    <table><tbody><tr><th>カードの種類</th><td class="type">サイキック・クリーチャー</td><th>文明</th><td class="civil">光</td></tr></tbody></table>
    <table><tbody>
      <tr><th class="full">特殊能力</th></tr>
      <tr><td class="skills full">W・ブレイカー</td></tr>
    </tbody></table>
  </div>
</div>
<div class="cardDetail">
  <div class="card-itself">
    <h3 class="card-name">変幻の覚醒者アンタッチャブル・パワード<span class="packname">(DM37 21/95)</span></h3>
    <table><tbody><tr><th>カードの種類</th><td class="type">サイキック・クリーチャー</td><th>文明</th><td class="civil">水</td></tr></tbody></table>
    <table><tbody>
      <tr><th class="full">特殊能力</th></tr>
      <tr><td class="skills full">スレイヤー</td></tr>
    </tbody></table>
  </div>
</div>
`;

const TWINPACT_DETAIL_HTML = `
<div class="cardDetail">
  <div class="card-itself">
    <h3 class="card-name">パルフェ・ルピア / 「あとはたのんだぞ」<span class="packname">(DM26EX2 17/89)</span></h3>
    <table><tbody><tr><th>カードの種類</th><td class="type">クリーチャー</td><th>文明</th><td class="civil">光</td></tr></tbody></table>
    <table><tbody>
      <tr><th class="full">特殊能力</th></tr>
      <tr><td class="skills full">ブロッカー</td></tr>
    </tbody></table>
  </div>
</div>
<div class="cardDetail">
  <div class="card-itself">
    <h3 class="card-name">パルフェ・ルピア / 「あとはたのんだぞ」<span class="packname">(DM26EX2 17/89)</span></h3>
    <table><tbody><tr><th>カードの種類</th><td class="type">呪文</td><th>文明</th><td class="civil">光</td></tr></tbody></table>
    <table><tbody>
      <tr><th class="full">特殊能力</th></tr>
      <tr><td class="skills full">次の中から1回選ぶ。</td></tr>
    </tbody></table>
  </div>
</div>
<input type="hidden" id="qa_url" value="https://dm.takaratomy.co.jp/rule/qa/49228/">
`;

describe("parseCardListPage", () => {
  it("検索結果からid/urlの一覧を重複なく抽出する", () => {
    const hits = parseCardListPage(LIST_HTML);
    expect(hits).toEqual([
      { id: "dm26ex3-SEC001", url: "https://dm.takaratomy.co.jp/card/detail/?id=dm26ex3-SEC001" },
      {
        id: "dm26ex3-SEC001CHO",
        url: "https://dm.takaratomy.co.jp/card/detail/?id=dm26ex3-SEC001CHO",
      },
    ]);
  });
});

describe("parseTotalCount", () => {
  it("件数テキストから数値を抽出する", () => {
    expect(parseTotalCount(LIST_HTML)).toBe(23310);
  });
});

describe("parseCardDetailPage", () => {
  it("カード詳細情報を抽出する", () => {
    const card = parseCardDetailPage(
      DETAIL_HTML,
      "dm26ex3-SEC001",
      "https://dm.takaratomy.co.jp/card/detail/?id=dm26ex3-SEC001",
    );
    expect(card).toEqual({
      id: "dm26ex3-SEC001",
      url: "https://dm.takaratomy.co.jp/card/detail/?id=dm26ex3-SEC001",
      name: "ボルメテウス・ホワイト・ドラゴン",
      alternateNames: [],
      cardType: "クリーチャー",
      civilization: "火",
      rarity: "SR",
      power: "7000",
      cost: "7",
      mana: "1",
      race: "アーマード・ドラゴン",
      cardText:
        "W・ブレイカー このクリーチャーがシールドをブレイクする時、相手はそのシールドを手札に加えるかわりに墓地に置く。",
      flavorText: "",
      illustrator: "Shigenobu Matsumoto",
      qaListUrl: "https://dm.takaratomy.co.jp/rule/qa/49228/",
      faces: [
        {
          name: "ボルメテウス・ホワイト・ドラゴン",
          cardType: "クリーチャー",
          civilization: "火",
          rarity: "SR",
          power: "7000",
          cost: "7",
          mana: "1",
          race: "アーマード・ドラゴン",
        },
      ],
    });
  });

  it("カード名が見つからない場合はnullを返す", () => {
    expect(parseCardDetailPage("<div></div>", "x", "https://example.com")).toBeNull();
  });

  it("ツインパクト等、複数面を持つカードは全面の能力テキストを連結する", () => {
    const card = parseCardDetailPage(
      TWINPACT_DETAIL_HTML,
      "dm26ex2-017",
      "https://dm.takaratomy.co.jp/card/detail/?id=dm26ex2-017",
    );
    expect(card?.cardText).toBe("ブロッカー\n---\n次の中から1回選ぶ。");
    expect(card?.qaListUrl).toBe("https://dm.takaratomy.co.jp/rule/qa/49228/");
    // ツインパクトは面ごとの表記が同一のため、alternateNamesに重複を持たない。
    expect(card?.alternateNames).toEqual([]);
    // facesには面ごとのcardType(クリーチャー/呪文)の違いが反映される。
    expect(card?.faces.map((f) => f.cardType)).toEqual(["クリーチャー", "呪文"]);
  });

  it("サイキック等、面ごとに異なる名前を持つカードは最初の面をname、それ以外をalternateNamesにする", () => {
    const card = parseCardDetailPage(
      PSYCHIC_DETAIL_HTML,
      "dm37-021",
      "https://dm.takaratomy.co.jp/card/detail/?id=dm37-021",
    );
    expect(card?.name).toBe("時空の英雄アンタッチャブル");
    expect(card?.alternateNames).toEqual(["変幻の覚醒者アンタッチャブル・パワード"]);
    expect(card?.cardText).toBe("W・ブレイカー\n---\nスレイヤー");
    // 裏面の属性(文明)が主要面と異なる場合でも、facesにそれぞれ正しく保持される。
    expect(card?.faces).toEqual([
      {
        name: "時空の英雄アンタッチャブル",
        cardType: "サイキック・クリーチャー",
        civilization: "光",
        rarity: "",
        power: "",
        cost: "",
        mana: "",
        race: "",
      },
      {
        name: "変幻の覚醒者アンタッチャブル・パワード",
        cardType: "サイキック・クリーチャー",
        civilization: "水",
        rarity: "",
        power: "",
        cost: "",
        mana: "",
        race: "",
      },
    ]);
  });
});
