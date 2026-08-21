import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { recordCardQuery, recordSourceReference, getTopCardQueries, getTopSourceReferences, searchSourceItems } =
  await import("../src/stats/statsRepository");

describe("stats/statsRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("recordCardQuery: INSERT ... ON CONFLICTでcard_query_statに保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    recordCardQuery("dm26ex3-005", "テストカード", "https://example.com/card");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO card_query_stat"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith(
      "dm26ex3-005",
      "テストカード",
      "https://example.com/card",
      expect.any(Number),
    );
  });

  it("recordSourceReference: INSERT ... ON CONFLICTでsource_reference_statに保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    recordSourceReference("generalRule", "509.2c", "総合ルール 509.2c", "https://example.com/rule");

    expect(prepareMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO source_reference_stat"),
    );
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith(
      "generalRule",
      "509.2c",
      "総合ルール 509.2c",
      "https://example.com/rule",
      expect.any(Number),
    );
  });

  it("getTopCardQueries: query_count降順で取得する", () => {
    const allFn = vi.fn().mockReturnValue([
      { cardId: "a", cardName: "カードA", cardUrl: "url-a", queryCount: 5, lastQueriedAt: 100 },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = getTopCardQueries(50);

    expect(result).toEqual([
      { cardId: "a", cardName: "カードA", cardUrl: "url-a", queryCount: 5, lastQueriedAt: 100 },
    ]);
    expect(allFn).toHaveBeenCalledWith(50);
  });

  it("getTopSourceReferences: sourceTypeで絞り込みreference_count降順で取得する", () => {
    const allFn = vi.fn().mockReturnValue([
      {
        sourceType: "qa",
        itemKey: "https://example.com/qa/1",
        title: "Q1",
        url: "https://example.com/qa/1",
        referenceCount: 3,
        lastReferencedAt: 200,
      },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = getTopSourceReferences("qa", 50);

    expect(result).toEqual([
      {
        sourceType: "qa",
        itemKey: "https://example.com/qa/1",
        title: "Q1",
        url: "https://example.com/qa/1",
        referenceCount: 3,
        lastReferencedAt: 200,
      },
    ]);
    expect(allFn).toHaveBeenCalledWith("qa", 50);
  });

  it("getTopSourceReferences: generalRuleの場合はgeneral_rule_chunkとJOINしてpreviewを含める", () => {
    const allFn = vi.fn().mockReturnValue([
      {
        sourceType: "generalRule",
        itemKey: "509.2c",
        title: "総合ルール 509.2c",
        url: "https://example.com/rule",
        referenceCount: 5,
        lastReferencedAt: 300,
        preview: "条文の本文...",
      },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = getTopSourceReferences("generalRule", 50);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("LEFT JOIN general_rule_chunk"));
    expect(allFn).toHaveBeenCalledWith(50);
    expect(result[0]!.preview).toBe("条文の本文...");
  });

  it("searchSourceItems: generalRuleはrule_number/textをLIKE検索しpreviewを含める", () => {
    const allFn = vi.fn().mockReturnValue([
      { itemKey: "509.2c", preview: "条文の本文...", referenceCount: 2, lastReferencedAt: 100 },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = searchSourceItems("generalRule", "ブレイカー", 50);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("FROM general_rule_chunk"));
    expect(allFn).toHaveBeenCalledWith("%ブレイカー%", "%ブレイカー%", 50);
    expect(result).toEqual([
      {
        sourceType: "generalRule",
        itemKey: "509.2c",
        title: "総合ルール 509.2c",
        url: expect.any(String),
        referenceCount: 2,
        lastReferencedAt: 100,
        preview: "条文の本文...",
      },
    ]);
  });

  it("searchSourceItems: qaはquestion/answerをLIKE検索する", () => {
    const allFn = vi.fn().mockReturnValue([
      {
        itemKey: "https://example.com/qa/1",
        title: "質問の冒頭60文字",
        url: "https://example.com/qa/1",
        referenceCount: 0,
        lastReferencedAt: 0,
      },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = searchSourceItems("qa", "侵略", 30);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("FROM qa_index"));
    expect(allFn).toHaveBeenCalledWith("%侵略%", "%侵略%", 30);
    expect(result[0]!.sourceType).toBe("qa");
  });

  it("searchSourceItems: ruleChangeはtitle/bodyをLIKE検索する", () => {
    const allFn = vi.fn().mockReturnValue([
      {
        itemKey: "https://example.com/rulechange/1",
        title: "ルール変更のお知らせ",
        url: "https://example.com/rulechange/1",
        referenceCount: 1,
        lastReferencedAt: 50,
      },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = searchSourceItems("ruleChange", "侵略", 30);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("FROM rule_change_cache"));
    expect(result[0]!.sourceType).toBe("ruleChange");
  });
});
