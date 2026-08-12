import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardSearchHit } from "../src/cards/types";

// cardSearch.ts はカード取得時にDB(node:sqlite)へ依存するモジュールを間接的に
// importするため、DB接続が発生しないようリポジトリ層をモックしておく。
vi.mock("../src/cards/cardRepository", () => ({
  getCachedCard: vi.fn(),
  saveCardToCache: vi.fn(),
}));

const postForm = vi.fn<(url: string, form: URLSearchParams) => Promise<string>>();
vi.mock("../src/utils/httpClient", () => ({
  postForm: (url: string, form: URLSearchParams) => postForm(url, form),
  fetchHtml: vi.fn(),
  fetchBinary: vi.fn(),
}));

// postFormのモックはform中のkeywordをそのまま「HTML」として返し、
// parseCardListPageのモックでそのkeywordに対応するヒット一覧を返す
// (実際のHTMLパースを介さず、keywordごとの検索結果を直接制御するため)。
const hitsByKeyword = new Map<string, CardSearchHit[]>();
vi.mock("../src/cards/cardParser", async () => {
  const actual = await vi.importActual<typeof import("../src/cards/cardParser")>("../src/cards/cardParser");
  return {
    ...actual,
    parseCardListPage: (html: string) => hitsByKeyword.get(html) ?? [],
  };
});

const { searchOfficialCards } = await import("../src/cards/cardSearch");

function setHits(keyword: string, hits: CardSearchHit[]): void {
  hitsByKeyword.set(keyword, hits);
}

describe("searchOfficialCards のフォールバック検索(中黒省略への対応)", () => {
  beforeEach(() => {
    postForm.mockReset();
    hitsByKeyword.clear();
    postForm.mockImplementation(async (_url, form) => form.get("keyword") ?? "");
  });

  it("primary検索でヒットすればfallbackは行わない", async () => {
    setHits("斬隠蒼頭龍バイケン", [{ id: "baiken", url: "u1" }]);

    const hits = await searchOfficialCards("斬隠蒼頭龍バイケン", { maxResults: 5 });

    expect(hits).toEqual([{ id: "baiken", url: "u1" }]);
    expect(postForm).toHaveBeenCalledTimes(1);
  });

  it("表記体系境界で分割できない語(中黒省略)で0件の場合、先頭を短縮したprefixと中黒結合クエリで再検索する", async () => {
    // 「セイントキャッスル」自体は0件(未設定)。prefix短縮候補のうち
    // 「セイント」(4文字)でヒットし、残り「キャッスル」と中黒結合した
    // 「セイント・キャッスル」で正確な候補が得られる。
    setHits("セイント", [{ id: "unrelated-1", url: "u1" }]);
    setHits("セイント・キャッスル", [{ id: "seint-castle", url: "utarget" }]);

    const hits = await searchOfficialCards("セイントキャッスル", { maxResults: 5 });

    expect(hits).toEqual([{ id: "seint-castle", url: "utarget" }]);
  });

  it("prefixヒットが多すぎて目的のカードが埋もれる場合でも、中黒結合クエリで絞り込んで拾う", async () => {
    // 「ボルシャック」単体は大量にヒットし(実際の公式サイトでも30件超)、
    // maxResults=5では目的の「ボルシャック・ドラゴン」が含まれない状況を再現。
    setHits(
      "ボルシャック",
      Array.from({ length: 10 }, (_, i) => ({ id: `other-${i}`, url: `u${i}` })),
    );
    setHits("ボルシャック・ドラゴン", [{ id: "target", url: "utarget" }]);

    const hits = await searchOfficialCards("ボルシャックドラゴン", { maxResults: 5 });

    expect(hits).toEqual([{ id: "target", url: "utarget" }]);
  });

  it("中黒結合クエリでもヒットしない場合は、素のfallbackトークンの結果をmaxResultsで返す", async () => {
    setHits(
      "ボルシャック",
      Array.from({ length: 10 }, (_, i) => ({ id: `other-${i}`, url: `u${i}` })),
    );
    // 「ボルシャック・ドラゴン」は未設定(=0件)のまま

    const hits = await searchOfficialCards("ボルシャックドラゴン", { maxResults: 3 });

    expect(hits).toHaveLength(3);
    expect(hits[0]).toEqual({ id: "other-0", url: "u0" });
  });

  it("どのfallbackトークンもヒットしない場合は空配列を返す", async () => {
    const hits = await searchOfficialCards("存在しないカード名です", { maxResults: 5 });
    expect(hits).toEqual([]);
  });
});
