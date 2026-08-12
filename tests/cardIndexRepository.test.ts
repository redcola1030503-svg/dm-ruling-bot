import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const {
  suggestCardNames,
  upsertCardIndexEntry,
  getCardIndexUpdatedAt,
  getCardIndexCount,
} = await import("../src/cards/cardIndexRepository");

describe("cards/cardIndexRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  describe("suggestCardNames", () => {
    it("クエリが2文字未満なら空配列を返しDBを呼ばない", () => {
      const result = suggestCardNames("セ", 10);

      expect(result).toEqual([]);
      expect(prepareMock).not.toHaveBeenCalled();
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
});
