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
  // 「過去のよくある質問」アーカイブ。現行の/rule/qa/検索一覧のページネーションでは
  // 辿れなくなった古いQ&Aがここにのみ残っている(全件クロール時は両方を対象にする)。
  DM_QA_OLD_URL: z.string().default("https://dm.takaratomy.co.jp/rule/qa_old/"),
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

  // Firebase Cloud Messaging送信用サービスアカウントJSON(base64エンコード)。
  // 未設定の場合、プッシュ送信は無効化され裁定生成自体は通常どおり動作する
  // (ポーリングでの結果取得は引き続き可能)。
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),

  // 同時実行中の裁定ジョブ数の上限。非同期化により同期HTTP接続数による
  // 自然な流量制御が失われるため、LLM APIのコスト・レート保護のため明示的に制限する。
  RULING_JOB_MAX_CONCURRENCY: z.coerce.number().default(5),

  // ruling_jobテーブルの保持期間(日)。古い完了/失敗ジョブはジョブ作成の
  // たびに機会的に削除する(Renderは単一インスタンスでcron等を持ち込む規模ではないため)。
  RULING_JOB_RETENTION_DAYS: z.coerce.number().default(3),

  // モバイルアプリの非同期裁定ジョブ(rulingJob.ts)経由の裁定生成のうち、非購読ユーザーの
  // ジョブのみ、Anthropic Message Batches APIを使う(入出力とも50%割引)。購読者は
  // 優先処理特典として常に通常APIを使う(src/routes/rulingJobs.tsのuseBatchApi算出を参照)。
  // LINE Bot・同期API(/api/ruling)は低レイテンシが必要なため対象外で常に通常APIを使う。
  // バッチは「ほとんど1時間以内に完了」だが保証はなく最大24時間かかりうるため、
  // レイテンシ悪化が許容できない場合はfalseに戻すだけで即座に通常APIへ復帰できる。
  RULING_USE_BATCH_API: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  // 無料で利用できる月間の質問数。これを超えるとサブスクリプションが必須になる。
  RULING_FREE_MONTHLY_LIMIT: z.coerce.number().default(10),

  // RevenueCat WebhookのAuthorizationヘッダに設定する共有シークレット。
  // RevenueCatダッシュボード(Project > Integrations > Webhooks)で同じ値を設定する。
  // 未設定の場合、Webhookエンドポイントは全リクエストを401で拒否する(安全側デフォルト)。
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),

  // RevenueCatのREST API(GetCustomerInfo)呼び出し用のSecret API Key。
  REVENUECAT_API_KEY: z.string().optional(),

  // RevenueCatダッシュボードで設定した、月額サブスクリプションのエンタイトルメントID。
  REVENUECAT_ENTITLEMENT_ID: z.string().default("unlimited_questions"),
});

export const env = envSchema.parse(process.env);
