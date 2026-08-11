import { describe, expect, it, vi } from "vitest";
import type { GeneralRuleEvidence } from "../src/rules/types";
import type { SemanticSearchResult } from "../src/search/semanticSearch";

const searchAndRankGeneralRules = vi.fn<() => Promise<GeneralRuleEvidence[]>>();
vi.mock("../src/rules/generalRuleRanking", () => ({
  searchAndRankGeneralRules: () => searchAndRankGeneralRules(),
}));

const semanticSearchGeneralRules = vi.fn<() => Promise<SemanticSearchResult[]>>();
vi.mock("../src/search/semanticSearch", () => ({
  semanticSearchGeneralRules: () => semanticSearchGeneralRules(),
}));

const { hybridSearchGeneralRules } = await import("../src/search/hybridSearch");

const EMPTY_CRITERIA = { cardNames: [], ruleConcepts: [], keywords: [] };

describe("hybridSearchGeneralRules", () => {
  it("keywordのみヒットした場合はその結果を返す", async () => {
    searchAndRankGeneralRules.mockResolvedValueOnce([
      { ruleNumber: "603.3", text: "text-603.3", score: 10 },
    ]);
    semanticSearchGeneralRules.mockResolvedValueOnce([]);

    const results = await hybridSearchGeneralRules("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.ruleNumber).toBe("603.3");
    expect(results[0]!.keywordScore).toBe(10);
    expect(results[0]!.embeddingScore).toBe(0);
  });

  it("embeddingのみヒットした場合はその結果を返す", async () => {
    searchAndRankGeneralRules.mockResolvedValueOnce([]);
    semanticSearchGeneralRules.mockResolvedValueOnce([
      { ruleNumber: "101.4", text: "text-101.4", embeddingScore: 0.8 },
    ]);

    const results = await hybridSearchGeneralRules("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.ruleNumber).toBe("101.4");
    expect(results[0]!.keywordScore).toBe(0);
    expect(results[0]!.embeddingScore).toBe(0.8);
  });

  it("両方でヒットした条文は重複排除され、両方のスコアを保持する", async () => {
    searchAndRankGeneralRules.mockResolvedValueOnce([
      { ruleNumber: "603.3", text: "text-603.3", score: 5 },
    ]);
    semanticSearchGeneralRules.mockResolvedValueOnce([
      { ruleNumber: "603.3", text: "text-603.3", embeddingScore: 0.9 },
    ]);

    const results = await hybridSearchGeneralRules("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.ruleNumber).toBe("603.3");
    expect(results[0]!.keywordScore).toBe(5);
    expect(results[0]!.embeddingScore).toBe(0.9);
    // 両方でヒットした条文は、片方だけでヒットした条文よりfinalScoreが高くなる
    expect(results[0]!.finalScore).toBeGreaterThan(0);
  });

  it("embedding検索が例外を投げてもkeyword結果のみで結果を返す(フォールバック)", async () => {
    searchAndRankGeneralRules.mockResolvedValueOnce([
      { ruleNumber: "603.3", text: "text-603.3", score: 10 },
    ]);
    semanticSearchGeneralRules.mockRejectedValueOnce(new Error("voyage_api_timeout"));

    const results = await hybridSearchGeneralRules("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.ruleNumber).toBe("603.3");
    expect(results[0]!.embeddingScore).toBe(0);
  });

  it("finalResultCountで返却件数を制御できる", async () => {
    searchAndRankGeneralRules.mockResolvedValueOnce([
      { ruleNumber: "a", text: "a", score: 3 },
      { ruleNumber: "b", text: "b", score: 2 },
      { ruleNumber: "c", text: "c", score: 1 },
    ]);
    semanticSearchGeneralRules.mockResolvedValueOnce([]);

    const results = await hybridSearchGeneralRules("質問", EMPTY_CRITERIA, { finalResultCount: 2 });

    expect(results).toHaveLength(2);
  });
});
