import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const execMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: {
    prepare: (...args: unknown[]) => prepareMock(...args),
    exec: (...args: unknown[]) => execMock(...args),
  },
}));

const {
  suggestCardNames,
  upsertCardIndexEntry,
  replaceCardIndexAltNames,
  upsertCardIndexEntryWithAltNames,
  getCardIndexUpdatedAt,
  getCardIndexCount,
  getLastKnownTotalCount,
  setLastKnownTotalCount,
} = await import("../src/cards/cardIndexRepository");

describe("cards/cardIndexRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    execMock.mockReset();
  });

  describe("suggestCardNames", () => {
    it("card_indexとcard_index_alt_nameの両方をUNIONで検索する(片方だけを検索するように壊れていないかの回帰確認)", () => {
      const all = vi.fn().mockReturnValue([]);
      prepareMock.mockReturnValue({ all });

      suggestCardNames("アンタッチャブル", 10);

      const sqlArg = prepareMock.mock.calls[0]?.[0] as string;
      expect(sqlArg).toContain("FROM card_index");
      expect(sqlArg).toContain("FROM card_index_alt_name");
      expect(sqlArg).toContain("UNION");
    });

    it("クエリが空文字なら空配列を返しDBを呼ばない", () => {
      const result = suggestCardNames("   ", 10);

      expect(result).toEqual([]);
      expect(prepareMock).not.toHaveBeenCalled();
    });

    it("1文字のクエリでも検索する(《零》のような1文字カード名に対応するため)", () => {
      const prefixAll = vi.fn().mockReturnValue([{ id: "a", name: "零" }]);
      prepareMock.mockReturnValueOnce({ all: prefixAll });

      // limitを1にして前方一致だけでlimitに達するようにし、部分一致クエリ
      // (2回目のprepare)が呼ばれないようにする。
      const result = suggestCardNames("零", 1);

      expect(result).toEqual([{ id: "a", name: "零" }]);
      expect(prefixAll).toHaveBeenCalledWith("零%", 1);
    });

    it("前方一致だけでlimitに達すれば部分一致は検索しない", () => {
      const prefixAll = vi.fn().mockReturnValue([
        { id: "a", name: "セイント・キャッスル" },
        { id: "b", name: "セイント・ガチ・マリア" },
      ]);
      prepareMock.mockReturnValueOnce({ all: prefixAll });

      const result = suggestCardNames("セイント", 2);

      expect(result).toEqual([
        { id: "a", name: "セイント・キャッスル" },
        { id: "b", name: "セイント・ガチ・マリア" },
      ]);
      expect(prefixAll).toHaveBeenCalledWith("セイント%", 2);
      // limitに達しているため部分一致クエリ(2回目のprepare)は呼ばれない
      expect(prepareMock).toHaveBeenCalledTimes(1);
    });

    it("前方一致が足りない場合は部分一致で補い、重複を除外する", () => {
      const prefixAll = vi.fn().mockReturnValue([{ id: "a", name: "ボルシャック・ドラゴン" }]);
      const partialAll = vi.fn().mockReturnValue([
        { id: "a", name: "ボルシャック・ドラゴン" }, // 前方一致と重複、除外される
        { id: "b", name: "ネオ・ボルシャック・ドラゴン" },
      ]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      const result = suggestCardNames("ボルシャック", 5);

      expect(result).toEqual([
        { id: "a", name: "ボルシャック・ドラゴン" },
        { id: "b", name: "ネオ・ボルシャック・ドラゴン" },
      ]);
      expect(partialAll).toHaveBeenCalledWith("%ボルシャック%", 5);
    });

    it("前後の空白はtrimしてから検索する", () => {
      const prefixAll = vi.fn().mockReturnValue([]);
      const partialAll = vi.fn().mockReturnValue([]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      suggestCardNames("  ボルシャック  ", 5);

      expect(prefixAll).toHaveBeenCalledWith("ボルシャック%", 5);
    });
  });

  it("upsertCardIndexEntry: INSERT ... ON CONFLICTで保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    upsertCardIndexEntry("dm26ex3-005", "テストカード", "https://example.com/card");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO card_index"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith(
      "dm26ex3-005",
      "テストカード",
      "https://example.com/card",
      expect.any(Number),
    );
  });

  it("replaceCardIndexAltNames: 既存の別名を削除してから新しい別名を登録する", () => {
    const deleteRun = vi.fn();
    const insertRun = vi.fn();
    prepareMock.mockReturnValueOnce({ run: deleteRun }).mockReturnValueOnce({ run: insertRun });

    replaceCardIndexAltNames("dm37-021", ["変幻の覚醒者アンタッチャブル・パワード"]);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM card_index_alt_name"));
    expect(deleteRun).toHaveBeenCalledWith("dm37-021");
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO card_index_alt_name"));
    expect(insertRun).toHaveBeenCalledWith("dm37-021", "変幻の覚醒者アンタッチャブル・パワード", expect.any(Number));
  });

  it("replaceCardIndexAltNames: 別名が0件の場合は削除のみでINSERTは呼ばない", () => {
    const deleteRun = vi.fn();
    prepareMock.mockReturnValueOnce({ run: deleteRun });

    replaceCardIndexAltNames("dm26ex3-005", []);

    expect(deleteRun).toHaveBeenCalledWith("dm26ex3-005");
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });

  describe("upsertCardIndexEntryWithAltNames", () => {
    it("BEGIN〜COMMITで主要名と別名の両方を1トランザクションとして更新する", () => {
      const runFn = vi.fn();
      prepareMock.mockReturnValue({ run: runFn });

      upsertCardIndexEntryWithAltNames("dm37-021", "時空の英雄アンタッチャブル", "https://example.com/a", [
        "変幻の覚醒者アンタッチャブル・パワード",
      ]);

      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "COMMIT"]);
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO card_index "));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM card_index_alt_name"));
      expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO card_index_alt_name"));
    });

    it("別名側の更新で例外が起きたらROLLBACKし、主要名だけ更新済みという不整合を残さない", () => {
      const runFn = vi.fn();
      prepareMock
        .mockReturnValueOnce({ run: runFn }) // upsertCardIndexEntry
        .mockImplementationOnce(() => {
          throw new Error("db error");
        }); // replaceCardIndexAltNamesのDELETEで失敗

      expect(() =>
        upsertCardIndexEntryWithAltNames("dm37-021", "時空の英雄アンタッチャブル", "https://example.com/a", [
          "変幻の覚醒者アンタッチャブル・パワード",
        ]),
      ).toThrow("db error");

      expect(execMock.mock.calls.map((c) => c[0])).toEqual(["BEGIN", "ROLLBACK"]);
    });
  });

  it("getCardIndexUpdatedAt: 存在すればupdated_atを返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ updated_at: 12345 }) });
    expect(getCardIndexUpdatedAt("dm26ex3-005")).toBe(12345);
  });

  it("getCardIndexUpdatedAt: 存在しなければnull", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getCardIndexUpdatedAt("nope")).toBeNull();
  });

  it("getCardIndexCount: 件数を返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ count: 11654 }) });
    expect(getCardIndexCount()).toBe(11654);
  });

  it("getLastKnownTotalCount: 存在すれば数値として返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ value: "11654" }) });
    expect(getLastKnownTotalCount()).toBe(11654);
  });

  it("getLastKnownTotalCount: 存在しなければnull(初回未実施)", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getLastKnownTotalCount()).toBeNull();
  });

  it("setLastKnownTotalCount: INSERT ... ON CONFLICTで保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    setLastKnownTotalCount(11700);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO card_index_meta"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith("last_known_total_count", "11700", expect.any(Number));
  });
});
