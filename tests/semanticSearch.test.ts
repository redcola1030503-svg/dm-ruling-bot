import { describe, expect, it, vi } from "vitest";

vi.mock("../src/embeddings/VoyageEmbeddingProvider", () => ({
  isEmbeddingSearchConfigured: () => false,
  VoyageEmbeddingProvider: class {
    embedQuery(): never {
      throw new Error("VOYAGE_API_KEY未設定時はembedQueryが呼ばれてはならない");
    }
  },
}));

const getAllGeneralRuleChunkRows = vi.fn();
vi.mock("../src/rules/generalRuleRepository", () => ({
  getAllGeneralRuleChunkRows: () => getAllGeneralRuleChunkRows(),
}));

const getAllQaIndexRowsWithEmbedding = vi.fn();
vi.mock("../src/rules/qaIndexRepository", () => ({
  getAllQaIndexRowsWithEmbedding: () => getAllQaIndexRowsWithEmbedding(),
}));

const { semanticSearchGeneralRules, semanticSearchQa } = await import("../src/search/semanticSearch");

describe("semanticSearchGeneralRules", () => {
  it("VOYAGE_API_KEY未設定の場合、DBアクセスやembedding呼び出しをせず空配列を返す", async () => {
    const results = await semanticSearchGeneralRules("質問", 10);

    expect(results).toEqual([]);
    expect(getAllGeneralRuleChunkRows).not.toHaveBeenCalled();
  });
});

describe("semanticSearchQa", () => {
  it("VOYAGE_API_KEY未設定の場合、DBアクセスやembedding呼び出しをせず空配列を返す", async () => {
    const results = await semanticSearchQa("質問", 10);

    expect(results).toEqual([]);
    expect(getAllQaIndexRowsWithEmbedding).not.toHaveBeenCalled();
  });
});
