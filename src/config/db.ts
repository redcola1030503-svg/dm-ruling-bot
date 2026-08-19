import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env";
import { computeGeneralRuleContentHash } from "../rules/contentHash";

mkdirSync(dirname(env.DATABASE_URL), { recursive: true });

export const db = new DatabaseSync(env.DATABASE_URL);

db.exec(`
  CREATE TABLE IF NOT EXISTS card_cache (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    card_type TEXT NOT NULL,
    civilization TEXT NOT NULL,
    rarity TEXT NOT NULL,
    power TEXT NOT NULL,
    cost TEXT NOT NULL,
    mana TEXT NOT NULL,
    race TEXT NOT NULL,
    card_text TEXT NOT NULL,
    flavor_text TEXT NOT NULL,
    illustrator TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qa_cache (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rule_change_cache (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    body TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rule_change_crawl_meta (
    key TEXT PRIMARY KEY,
    crawled_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversation_user
    ON conversation_history(user_id, created_at);

  CREATE TABLE IF NOT EXISTS general_rule_chunk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_number TEXT NOT NULL,
    text TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS general_rule_crawl_meta (
    key TEXT PRIMARY KEY,
    crawled_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS correction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_question TEXT NOT NULL,
    bot_conclusion TEXT NOT NULL,
    correct_ruling TEXT NOT NULL,
    card_names TEXT NOT NULL,
    corrected_by TEXT NOT NULL,
    judge_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS judge_session (
    user_id TEXT PRIMARY KEY,
    judge_id TEXT NOT NULL,
    logged_in_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS judge (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('judge', 'admin')),
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_index (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_card_index_name ON card_index(name);

  CREATE TABLE IF NOT EXISTS card_index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ruling_job (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    question TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'done', 'failed')),
    outcome_status TEXT,
    result_json TEXT,
    error TEXT,
    notified_at INTEGER,
    thread_id TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_ruling_job_device ON ruling_job(device_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ruling_job_created ON ruling_job(created_at);

  CREATE TABLE IF NOT EXISTS ruling_thread (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ruling_thread_device ON ruling_thread(device_id, updated_at);

  CREATE TABLE IF NOT EXISTS device_push_token (
    device_id TEXT PRIMARY KEY,
    fcm_token TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_query_stat (
    card_id TEXT PRIMARY KEY,
    card_name TEXT NOT NULL,
    card_url TEXT NOT NULL DEFAULT '',
    query_count INTEGER NOT NULL DEFAULT 0,
    last_queried_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_reference_stat (
    source_type TEXT NOT NULL,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    reference_count INTEGER NOT NULL DEFAULT 0,
    last_referenced_at INTEGER NOT NULL,
    PRIMARY KEY (source_type, item_key)
  );

  CREATE INDEX IF NOT EXISTS idx_source_reference_stat_ranking
    ON source_reference_stat(source_type, reference_count DESC);
`);

// 既存DBへのマイグレーション(カラム追加は非冪等なため個別に試行する)。
try {
  db.exec("ALTER TABLE card_cache ADD COLUMN qa_list_url TEXT");
} catch {
  // 既にカラムが存在する場合は無視
}
try {
  db.exec("ALTER TABLE correction ADD COLUMN judge_id TEXT NOT NULL DEFAULT ''");
} catch {
  // 既にカラムが存在する場合は無視
}
try {
  db.exec("ALTER TABLE ruling_job ADD COLUMN thread_id TEXT");
} catch {
  // 既にカラムが存在する場合は無視
}
// thread_idカラムの追加(CREATE TABLE時点、または直前のALTER TABLE)より後でないと
// 既存DBでカラム不在エラーになるため、インデックス作成はここに置く。
db.exec("CREATE INDEX IF NOT EXISTS idx_ruling_job_thread ON ruling_job(thread_id, created_at)");

// 総合ルールembedding検索(Voyage AI)用のカラム。
// content_hash: rule_number+textの内容ハッシュ。クロール時の差分更新(同一内容の
//   行はembeddingを保持したまま残す)判定に使う。
// embedding_text_hash: embedding生成時点の本文ハッシュ。content_hashと異なれば
//   本文が変わったとみなし再生成する。
for (const ddl of [
  "ALTER TABLE general_rule_chunk ADD COLUMN content_hash TEXT",
  "ALTER TABLE general_rule_chunk ADD COLUMN embedding BLOB",
  "ALTER TABLE general_rule_chunk ADD COLUMN embedding_model TEXT",
  "ALTER TABLE general_rule_chunk ADD COLUMN embedding_dimensions INTEGER",
  "ALTER TABLE general_rule_chunk ADD COLUMN embedding_text_hash TEXT",
  "ALTER TABLE general_rule_chunk ADD COLUMN embedding_updated_at TEXT",
]) {
  try {
    db.exec(ddl);
  } catch {
    // 既にカラムが存在する場合は無視
  }
}

// embedding機能導入前から存在する行はcontent_hashが未設定のため、一度だけ
// バックフィルする(以後は差分更新のたびに新規行へ設定されるため対象0件になる)。
const rowsNeedingHash = db
  .prepare("SELECT id, rule_number, text FROM general_rule_chunk WHERE content_hash IS NULL")
  .all() as { id: number; rule_number: string; text: string }[];
if (rowsNeedingHash.length > 0) {
  const updateContentHash = db.prepare("UPDATE general_rule_chunk SET content_hash = ? WHERE id = ?");
  for (const row of rowsNeedingHash) {
    const hash = computeGeneralRuleContentHash({ ruleNumber: row.rule_number, text: row.text });
    updateContentHash.run(hash, row.id);
  }
}

// 起動のたびに、環境変数のジャッジ/管理者のうちDBにまだ存在しないIDだけを
// 追加する(INSERT OR IGNOREで既存行は上書きしない)。「judgeテーブルが空の
// 場合のみ」という初回限定の判定にすると、環境変数を後から追加しても、DBが
// 一度でも作られていれば反映されない問題が起きるため、起動毎の差分追加に
// している。/judge_removeで削除したIDが環境変数に残っていると再デプロイの
// たびに復活してしまう点には注意(削除する場合は環境変数側からも外すこと)。
const insertJudgeIfAbsent = db.prepare(
  "INSERT OR IGNORE INTO judge (id, role, created_at, created_by) VALUES (?, ?, ?, ?)",
);
const seededAt = Date.now();
for (const id of env.VALID_JUDGE_IDS) {
  insertJudgeIfAbsent.run(id, "judge", seededAt, "env:VALID_JUDGE_IDS");
}
for (const id of env.ADMIN_JUDGE_IDS) {
  insertJudgeIfAbsent.run(id, "admin", seededAt, "env:ADMIN_JUDGE_IDS");
}
