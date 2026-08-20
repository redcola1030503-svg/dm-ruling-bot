import { VoyageEmbeddingProvider, isEmbeddingSearchConfigured } from "../embeddings/VoyageEmbeddingProvider";
import { getAllGeneralRuleChunkRows } from "../rules/generalRuleRepository";
import { getAllQaIndexRowsWithEmbedding } from "../rules/qaIndexRepository";
import type { GeneralRuleChunk, QaDetail } from "../rules/types";
import { cosineSimilarity } from "./similarity";

export type SemanticSearchResult = GeneralRuleChunk & {
  embeddingScore: number;
};

export type QaSemanticSearchResult = QaDetail & {
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

/**
 * ユーザーの元の質問文そのものをembeddingし、qa_index(全件クロール済みQ&A
 * コーパス)に保存済みのembeddingとのコサイン類似度で上位topN件を返す。
 * カード名やルール用語が質問文と完全に異なっていても、処理が近い過去のQ&A
 * (別カードを例にした同種の裁定パターン)を意味的に拾えるようにするための
 * 検索経路(semanticSearchGeneralRulesのQA版)。
 * VOYAGE_API_KEY未設定、またはembedding未生成のQ&Aしかない場合は空配列を返す。
 */
export async function semanticSearchQa(
  question: string,
  topN: number,
): Promise<QaSemanticSearchResult[]> {
  if (!isEmbeddingSearchConfigured()) return [];

  const rows = getAllQaIndexRowsWithEmbedding();
  if (rows.length === 0) return [];

  const provider = new VoyageEmbeddingProvider();
  const queryEmbedding = Float32Array.from(await provider.embedQuery(question));

  const scored: QaSemanticSearchResult[] = rows.map((row) => ({
    id: row.id,
    url: row.url,
    question: row.question,
    answer: row.answer,
    embeddingScore: cosineSimilarity(queryEmbedding, row.embedding),
  }));

  scored.sort((a, b) => b.embeddingScore - a.embeddingScore);
  return scored.slice(0, topN);
}
