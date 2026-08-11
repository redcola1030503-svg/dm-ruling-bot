import axios from "axios";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import type { EmbeddingProvider } from "./EmbeddingProvider";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const QUERY_TIMEOUT_MS = 5_000;
const DOCUMENT_TIMEOUT_MS = 30_000; // バッチ生成は件数が多いため長めに許容する
const MAX_BATCH_SIZE = 100; // Voyage APIの1リクエストあたり入力件数を抑えるための目安値

type VoyageEmbeddingResponseItem = { embedding: number[]; index: number };
type VoyageEmbeddingResponse = { data: VoyageEmbeddingResponseItem[] };

async function requestEmbeddings(
  input: string[],
  inputType: "query" | "document",
  timeoutMs: number,
): Promise<number[][]> {
  const response = await axios.post<VoyageEmbeddingResponse>(
    VOYAGE_API_URL,
    {
      input,
      model: env.VOYAGE_EMBEDDING_MODEL,
      input_type: inputType,
    },
    {
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
    },
  );

  return response.data.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  constructor() {
    if (!env.VOYAGE_API_KEY) {
      throw new Error("VOYAGE_API_KEY is not configured");
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await requestEmbeddings([text], "query", QUERY_TIMEOUT_MS);
    if (!embedding) {
      throw new Error("voyage_embed_query_empty_response");
    }
    return embedding;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const embeddings = await requestEmbeddings(batch, "document", DOCUMENT_TIMEOUT_MS);
      results.push(...embeddings);
      logger.info("voyage_embed_batch_done", { batchStart: i, batchSize: batch.length });
    }
    return results;
  }
}

export function isEmbeddingSearchConfigured(): boolean {
  return Boolean(env.VOYAGE_API_KEY);
}
