import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),

  PORT: z.coerce.number().default(3000),

  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  // 初回起動時のみ、ジャッジ/管理者としてDB(judgeテーブル)にシードするIDの
  // カンマ区切りリスト。以後の登録・削除はDB側(/judge_add, /judge_remove
  // コマンド)で管理するため、ここを変更しても既存DBには反映されない。
  VALID_JUDGE_IDS: z
    .string()
    .default("")
    .transform((value) => new Set(value.split(",").map((id) => id.trim()).filter((id) => id.length > 0))),
  // 管理者権限(ジャッジIDの登録・削除が可能)でシードするIDのカンマ区切りリスト。
  ADMIN_JUDGE_IDS: z
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

  // カード名があいまいな場合にClaude APIのWeb検索ツールで環境での話題度を調査し、
  // 圧倒的に優勢な候補があれば自動確定する機能。無効化するとWeb検索は行わず
  // 従来通り常にユーザーへ候補確認を返す。LLM_API_KEYが必要(未設定時は自動的に無効)。
  ENABLE_POPULARITY_CARD_RESOLUTION: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
});

export const env = envSchema.parse(process.env);
