import { describe, expect, it, vi } from "vitest";
import type { GeneralRuleEvidence, QaEvidence } from "../src/rules/types";
import type { QaSemanticSearchResult, SemanticSearchResult } from "../src/search/semanticSearch";

const searchAndRankGeneralRules = vi.fn<() => Promise<GeneralRuleEvidence[]>>();
vi.mock("../src/rules/generalRuleRanking", () => ({
  searchAndRankGeneralRules: () => searchAndRankGeneralRules(),
}));

const searchAndRankQa = vi.fn<() => Promise<QaEvidence[]>>();
vi.mock("../src/rules/qaRanking", () => ({
  searchAndRankQa: () => searchAndRankQa(),
}));

const semanticSearchGeneralRules = vi.fn<() => Promise<SemanticSearchResult[]>>();
const semanticSearchQa = vi.fn<() => Promise<QaSemanticSearchResult[]>>();
vi.mock("../src/search/semanticSearch", () => ({
  semanticSearchGeneralRules: () => semanticSearchGeneralRules(),
  semanticSearchQa: () => semanticSearchQa(),
}));

const { hybridSearchGeneralRules, hybridSearchQa } = await import("../src/search/hybridSearch");

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

describe("hybridSearchQa", () => {
  it("keywordのみヒットした場合はその結果を返す", async () => {
    searchAndRankQa.mockResolvedValueOnce([
      { id: "1", url: "https://example.com/1", question: "Q1", answer: "A1", score: 10 },
    ]);
    semanticSearchQa.mockResolvedValueOnce([]);

    const results = await hybridSearchQa("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("keywordでは見つからずembeddingのみでヒットした場合も、別カード名のQ&Aを拾える", async () => {
    searchAndRankQa.mockResolvedValueOnce([]);
    semanticSearchQa.mockResolvedValueOnce([
      { id: "33288", url: "https://dm.takaratomy.co.jp/rule/qa/33288/", question: "Q2", answer: "A2", embeddingScore: 0.85 },
    ]);

    const results = await hybridSearchQa("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("33288");
    expect(results[0]!.question).toBe("Q2");
  });

  it("両方でヒットしたQ&Aは重複排除され、片方だけの場合よりスコアが高くなる", async () => {
    searchAndRankQa.mockResolvedValueOnce([
      { id: "1", url: "https://example.com/1", question: "Q1", answer: "A1", score: 5 },
      { id: "2", url: "https://example.com/2", question: "Q2", answer: "A2", score: 5 },
    ]);
    semanticSearchQa.mockResolvedValueOnce([
      { id: "1", url: "https://example.com/1", question: "Q1", answer: "A1", embeddingScore: 0.9 },
    ]);

    const results = await hybridSearchQa("質問", EMPTY_CRITERIA);

    const both = results.find((r) => r.id === "1")!;
    const keywordOnly = results.find((r) => r.id === "2")!;
    expect(both.score).toBeGreaterThan(keywordOnly.score);
  });

  it("embedding検索が例外を投げてもkeyword結果のみで結果を返す(フォールバック)", async () => {
    searchAndRankQa.mockResolvedValueOnce([
      { id: "1", url: "https://example.com/1", question: "Q1", answer: "A1", score: 10 },
    ]);
    semanticSearchQa.mockRejectedValueOnce(new Error("voyage_api_timeout"));

    const results = await hybridSearchQa("質問", EMPTY_CRITERIA);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1");
  });

  it("finalResultCountで返却件数を制御できる", async () => {
    searchAndRankQa.mockResolvedValueOnce([
      { id: "1", url: "https://example.com/1", question: "Q1", answer: "A1", score: 3 },
      { id: "2", url: "https://example.com/2", question: "Q2", answer: "A2", score: 2 },
      { id: "3", url: "https://example.com/3", question: "Q3", answer: "A3", score: 1 },
    ]);
    semanticSearchQa.mockResolvedValueOnce([]);

    const results = await hybridSearchQa("質問", EMPTY_CRITERIA, { finalResultCount: 2 });

    expect(results).toHaveLength(2);
  });
});
