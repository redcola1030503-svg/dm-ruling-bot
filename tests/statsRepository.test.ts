import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { recordCardQuery, recordSourceReference, getTopCardQueries, getTopSourceReferences } =
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
});
