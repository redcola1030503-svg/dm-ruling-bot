import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),

  PORT: z.coerce.number().default(3000),

  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  // /login コマンドでログインを許可する、有効な公認ジャッジIDのカンマ区切りリスト。
  // ここに登録されたジャッジIDでログインしたLINEユーザーのみ /訂正 コマンドを実行できる。
  VALID_JUDGE_IDS: z
    .string()
    .default("")
    .transform((value) => new Set(value.split(",").map((id) => id.trim()).filter((id) => id.length > 0))),

  LLM_API_KEY: z.string().optional(),

  // Voyage AI embedding(意味検索)。未設定の場合、embedding検索は無効化され
  // 既存のキーワード検索のみで動作する。
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_EMBEDDING_MODEL: z.string().default("voyage-4"),

  SEARCH_EMBEDDING_WEIGHT: z.coerce.number().default(0.75),
  SEARCH_KEYWORD_WEIGHT: z.coerce.number().default(0.25),
  SEARCH_SEMANTIC_CANDIDATES: z.coerce.number().default(20),
  SEARCH_FINAL_RESULTS: z.coerce.number().default(5),

  DATABASE_URL: z.string().default("./data/cache.db"),

  DM_CARD_BASE_URL: z.string().default("https://dm.takaratomy.co.jp/card/"),
  DM_QA_URL: z.string().default("https://dm.takaratomy.co.jp/rule/qa/"),
  DM_RULE_CHANGE_URL: z
    .string()
    .default("https://dm.takaratomy.co.jp/rule/rulechange/change/"),
  DM_GENERAL_RULE_PAGE_URL: z
    .string()
    .default("https://dm.takaratomy.co.jp/rule/rulechange/"),

  ENABLE_DEBUG_ROUTES: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
});

export const env = envSchema.parse(process.env);
