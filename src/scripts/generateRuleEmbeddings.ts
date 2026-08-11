import { env } from "../config/env";
import { logger } from "../utils/logger";
import { getAllGeneralRuleChunkRows, saveGeneralRuleEmbedding } from "../rules/generalRuleRepository";
import { VoyageEmbeddingProvider, isEmbeddingSearchConfigured } from "../embeddings/VoyageEmbeddingProvider";

const BATCH_SIZE = 100;

async function main(): Promise<void> {
  if (!isEmbeddingSearchConfigured()) {
    console.error("VOYAGE_API_KEY が設定されていません。embedding生成をスキップしました。");
    process.exitCode = 1;
    return;
  }

  const rows = getAllGeneralRuleChunkRows();
  const newRows = rows.filter((row) => !row.embedding);
  const targets = rows.filter(
    (row) =>
      !row.embedding ||
      row.embeddingModel !== env.VOYAGE_EMBEDDING_MODEL ||
      row.embeddingTextHash !== row.contentHash,
  );
  const updateRows = targets.filter((row) => row.embedding);
  const skipCount = rows.length - targets.length;

  console.log(`対象条文数: ${rows.length}`);
  console.log(`embedding生成済み: ${rows.length - newRows.length}`);
  console.log(`新規生成: ${newRows.length}`);
  console.log(`更新: ${updateRows.length}`);
  console.log(`スキップ: ${skipCount}`);

  if (targets.length === 0) {
    console.log("失敗: 0");
    return;
  }

  const provider = new VoyageEmbeddingProvider();
  let failedCount = 0;

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    try {
      const embeddings = await provider.embedDocuments(batch.map((row) => row.text));
      batch.forEach((row, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
          failedCount += 1;
          return;
        }
        saveGeneralRuleEmbedding({
          id: row.id,
          embedding,
          model: env.VOYAGE_EMBEDDING_MODEL,
          textHash: row.contentHash,
        });
      });
    } catch (error) {
      failedCount += batch.length;
      logger.error("embedding_batch_failed", {
        batchStart: i,
        batchSize: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`失敗: ${failedCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
