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
      // T009: 部分一致の取得件数はlimit + prefixRows.length(除外されうる分の余裕)
      expect(partialAll).toHaveBeenCalledWith("%ボルシャック%", 6);
    });

    it("前後の空白はtrimしてから検索する", () => {
      const prefixAll = vi.fn().mockReturnValue([]);
      const partialAll = vi.fn().mockReturnValue([]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      suggestCardNames("  ボルシャック  ", 5);

      expect(prefixAll).toHaveBeenCalledWith("ボルシャック%", 5);
    });

    it("T009: SQLはid単位集約(内側)の後にさらにname単位集約(外側)を行い、LIMITは外側に適用する(同名再録カードの重複排除がLIMIT前に行われることの回帰確認)", () => {
      const all = vi.fn().mockReturnValue([]);
      prepareMock.mockReturnValue({ all });

      suggestCardNames("輝きは", 10);

      const sqlArg = prepareMock.mock.calls[0]?.[0] as string;
      // 内側: id単位のGROUP BY(T004由来、表/裏面の重複排除)を維持している
      expect(sqlArg).toMatch(/GROUP BY id/);
      // 外側: name単位のGROUP BY(T009、同名再録カードの重複排除)を追加している
      expect(sqlArg).toMatch(/GROUP BY name/);
      // LIMITはname単位集約後の外側クエリに書かれている(内側の直後ではない)
      const groupByNameIndex = sqlArg.indexOf("GROUP BY name");
      const limitIndex = sqlArg.indexOf("LIMIT");
      expect(groupByNameIndex).toBeGreaterThan(-1);
      expect(limitIndex).toBeGreaterThan(groupByNameIndex);
    });

    it("T009: 同名だが異なるidの行がDB結果に含まれる場合、name単位で1件にまとめる(SQL側のGROUP BY nameが正しく動作した状況を模したモック結果)", () => {
      // 実際のSQLiteではGROUP BY nameにより同名行は既に1行に集約されて返るため、
      // ここではSQLが正しく集約した後の結果(1行)を模擬してJS側の受け口を検証する。
      const prefixAll = vi.fn().mockReturnValue([{ id: "dm25ex3-002", name: "〜輝きは奇跡そのもの〜" }]);
      const partialAll = vi.fn().mockReturnValue([]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      const result = suggestCardNames("輝きは", 10);

      expect(result).toEqual([{ id: "dm25ex3-002", name: "〜輝きは奇跡そのもの〜" }]);
    });

    it("T009: 同一idが前方一致・部分一致で異なる面名を返す場合でも、そのidは1件だけ返す(seenIdsとseenNames併用の回帰確認、Codexレビュー指摘)", () => {
      // 前方一致では「ZooFront」、部分一致では同じidの別面名「AZooBack」が
      // 選ばれる状況を模擬する(内側のMIN(name)が対象集合の違いで異なる名前を
      // 選ぶケース)。seenNamesだけで重複排除すると誤って2件返ってしまう。
      const prefixAll = vi.fn().mockReturnValue([{ id: "shared-id", name: "ZooFront" }]);
      const partialAll = vi.fn().mockReturnValue([{ id: "shared-id", name: "AZooBack" }]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      const result = suggestCardNames("Zoo", 5);

      expect(result).toEqual([{ id: "shared-id", name: "ZooFront" }]);
    });

    it("T009: 別idの同名行は部分一致側でも重複排除される(前方一致で既に登場した名前は部分一致から除外)", () => {
      const prefixAll = vi.fn().mockReturnValue([{ id: "dm25ex3-002", name: "〜輝きは奇跡そのもの〜" }]);
      const partialAll = vi.fn().mockReturnValue([
        { id: "dm25rp3-012", name: "〜輝きは奇跡そのもの〜" }, // 別id・同名、除外される
        { id: "dm26-999", name: "輝きはじける未来" }, // 別名、残る
      ]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      const result = suggestCardNames("輝きは", 5);

      expect(result).toEqual([
        { id: "dm25ex3-002", name: "〜輝きは奇跡そのもの〜" },
        { id: "dm26-999", name: "輝きはじける未来" },
      ]);
    });

    it("T009: 前方一致1件がid重複・name重複の2行を部分一致側で除外しても、他の新規候補でlimitまで満たす(Codexレビュー指摘、2026-09-05: 部分一致の取得件数をlimitのままにすると、除外分だけ新規候補が不足しうる)", () => {
      const prefixAll = vi.fn().mockReturnValue([{ id: "a", name: "ZooFront" }]);
      const partialAll = vi.fn().mockReturnValue([
        { id: "a", name: "AZooBack" }, // 前方一致と同じid(別面名)、seenIdsで除外
        { id: "b", name: "ZooFront" }, // 前方一致と同じname(別id)、seenNamesで除外
        { id: "c", name: "ZooC" },
        { id: "d", name: "ZooD" },
        { id: "e", name: "ZooE" },
        { id: "f", name: "ZooF" }, // limit(5)を満たすのに必要な6件目
      ]);
      prepareMock.mockReturnValueOnce({ all: prefixAll }).mockReturnValueOnce({ all: partialAll });

      const result = suggestCardNames("Zoo", 5);

      // 前方一致1件(a) + 新規4件(c,d,e,f) = 5件(limit)。2件(id重複・name重複)を
      // 除外してもなお必要な新規件数を確保できていることを確認する。
      expect(result).toEqual([
        { id: "a", name: "ZooFront" },
        { id: "c", name: "ZooC" },
        { id: "d", name: "ZooD" },
        { id: "e", name: "ZooE" },
        { id: "f", name: "ZooF" },
      ]);
      // 前方一致1件のため、部分一致はlimit(5) + prefixRows.length(1) = 6件取得する
      expect(partialAll).toHaveBeenCalledWith("%Zoo%", 6);
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
