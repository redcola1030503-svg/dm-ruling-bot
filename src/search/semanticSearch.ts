import { VoyageEmbeddingProvider, isEmbeddingSearchConfigured } from "../embeddings/VoyageEmbeddingProvider";
import { getAllGeneralRuleChunkRows } from "../rules/generalRuleRepository";
import type { GeneralRuleChunk } from "../rules/types";
import { cosineSimilarity } from "./similarity";

export type SemanticSearchResult = GeneralRuleChunk & {
  embeddingScore: number;
};

/**
 * ユーザーの元の質問文そのものをembeddingし、DBに保存済みの総合ルール
 * embeddingとのコサイン類似度で上位topN件を返す。
 * LLMが抽出した検索語(ruleConcepts/keywords)ではなく、質問文全体を使うのは、
 * embeddingが文脈全体の意味を捉えるための表現であり、断片的なキーワードに
 * 分解すると逆に情報が失われるため。
 * VOYAGE_API_KEY未設定、またはembedding未生成の条文しかない場合は空配列を返す。
 */
export async function semanticSearchGeneralRules(
  question: string,
  topN: number,
): Promise<SemanticSearchResult[]> {
  if (!isEmbeddingSearchConfigured()) return [];

  const rows = getAllGeneralRuleChunkRows().filter(
    (row): row is typeof row & { embedding: Float32Array } => row.embedding !== null,
  );
  if (rows.length === 0) return [];

  const provider = new VoyageEmbeddingProvider();
  const queryEmbedding = Float32Array.from(await provider.embedQuery(question));

  const scored: SemanticSearchResult[] = rows.map((row) => ({
    ruleNumber: row.ruleNumber,
    text: row.text,
    embeddingScore: cosineSimilarity(queryEmbedding, row.embedding),
  }));

  scored.sort((a, b) => b.embeddingScore - a.embeddingScore);
  return scored.slice(0, topN);
}
