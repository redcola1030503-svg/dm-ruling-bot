import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const {
  upsertQaIndexEntry,
  getQaIndexUpdatedAt,
  getQaIndexCount,
  getAllQaIndexRowsWithEmbedding,
  getAllQaIndexChunkRows,
  saveQaEmbedding,
} = await import("../src/rules/qaIndexRepository");

describe("rules/qaIndexRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("upsertQaIndexEntry: INSERT ... ON CONFLICTで保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    upsertQaIndexEntry({ id: "12345", url: "https://example.com/12345", question: "Q", answer: "A" });

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO qa_index"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith(
      "12345",
      "https://example.com/12345",
      "Q",
      "A",
      expect.any(String),
      expect.any(Number),
    );
  });

  it("getQaIndexUpdatedAt: 存在すればupdated_atを返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ updated_at: 12345 }) });
    expect(getQaIndexUpdatedAt("12345")).toBe(12345);
  });

  it("getQaIndexUpdatedAt: 存在しなければnull", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getQaIndexUpdatedAt("nope")).toBeNull();
  });

  it("getQaIndexCount: 件数を返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ count: 4023 }) });
    expect(getQaIndexCount()).toBe(4023);
  });

  it("getAllQaIndexRowsWithEmbedding: embedding済みの行をFloat32Arrayに変換して返す", () => {
    const embedding = Buffer.from(Float32Array.from([0.1, 0.2, 0.3]).buffer);
    prepareMock.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { id: "1", url: "https://example.com/1", question: "Q1", answer: "A1", embedding },
      ]),
    });

    const result = getAllQaIndexRowsWithEmbedding();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
    expect(Array.from(result[0]!.embedding)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
  });

  it("getAllQaIndexChunkRows: embedding未生成の行はnullとして返す", () => {
    prepareMock.mockReturnValue({
      all: vi.fn().mockReturnValue([
        {
          id: "1",
          url: "https://example.com/1",
          question: "Q1",
          answer: "A1",
          content_hash: "hash1",
          embedding: null,
          embedding_model: null,
          embedding_text_hash: null,
        },
      ]),
    });

    const result = getAllQaIndexChunkRows();

    expect(result).toEqual([
      {
        id: "1",
        url: "https://example.com/1",
        question: "Q1",
        answer: "A1",
        contentHash: "hash1",
        embedding: null,
        embeddingModel: null,
        embeddingTextHash: null,
      },
    ]);
  });

  it("saveQaEmbedding: UPDATE文でembedding列を保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    saveQaEmbedding({ id: "1", embedding: [0.1, 0.2], model: "voyage-4", textHash: "hash1" });

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("UPDATE qa_index"));
    expect(runFn).toHaveBeenCalledWith(
      expect.any(Buffer),
      "voyage-4",
      2,
      "hash1",
      expect.any(String),
      "1",
    );
  });
});
