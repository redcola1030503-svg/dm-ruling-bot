import type { SQLInputValue } from "node:sqlite";
import { db } from "../config/db";
import type { RulingResult } from "./types";
import { decrementMonthlyUsage } from "../billing/deviceMonthlyUsageRepository";
import { logger } from "../utils/logger";

export type RulingJobStatus = "pending" | "running" | "done" | "failed";

export type RulingJobRow = {
  id: string;
  device_id: string | null;
  question: string;
  status: RulingJobStatus;
  outcome_status: string | null;
  result_json: string | null;
  error: string | null;
  notified_at: number | null;
  thread_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  usage_month_key: string | null;
  refunded_at: number | null;
  worker_id: string | null;
  heartbeat_at: number | null;
};

export function createJob(
  id: string,
  question: string,
  deviceId: string | null,
  threadId: string | null,
  // T010: このジョブが消費した無料枠のmonthKey。購読中・無料枠を消費しない
  // 場合はnull(finalizeRulingJobの返金判定はこの値の有無で行う)。
  usageMonthKey: string | null,
): void {
  db.prepare(
    `INSERT INTO ruling_job (id, device_id, question, status, thread_id, usage_month_key, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, deviceId, question, threadId, usageMonthKey, Date.now());
}

// workerIdは呼び出し元プロセスを識別するID(rulingJob.tsのWORKER_ID)。
// heartbeat_atも同時に打刻することで、開始直後から孤立ジョブ回収の対象外にする。
export function markRunning(id: string, workerId: string): void {
  const now = Date.now();
  db.prepare("UPDATE ruling_job SET status = 'running', started_at = ?, worker_id = ?, heartbeat_at = ? WHERE id = ?").run(
    now,
    workerId,
    now,
    id,
  );
}

// T012 Review 8: このプロセスが現在も処理中であることをDBへ定期的に伝える生存確認。
// workerIdが一致し、かつまだ'running'のジョブのみを更新する(既に孤立ジョブ回収や
// 通常完了で確定済みのジョブへは影響しない)。
export function renewHeartbeat(id: string, workerId: string): void {
  db.prepare(
    "UPDATE ruling_job SET heartbeat_at = ? WHERE id = ? AND worker_id = ? AND status = 'running'",
  ).run(Date.now(), id, workerId);
}

export function markNotified(id: string): void {
  db.prepare("UPDATE ruling_job SET notified_at = ? WHERE id = ?").run(Date.now(), id);
}

// T010: "ok"(正常に裁定を生成できた)以外は無料枠の返金対象とする
// (evidence_error/llm_error/needs_clarification、およびproduceRuling自体が
// 例外を投げて解決に至らなかった"failed"の全て)。
function isRefundableOutcome(params: FinalizeRulingJobParams): boolean {
  return !(params.outcome === "done" && params.outcomeStatus === "ok");
}

export type FinalizeRulingJobParams =
  | { outcome: "done"; outcomeStatus: string; result: RulingResult }
  | { outcome: "failed"; error: string };

export type FinalizeRulingJobResult =
  // won=true: このジョブの確定処理を実際に行った(呼び出し元は通知等の後続処理を実行してよい)。
  | { won: true; refunded: boolean; deviceId: string | null }
  // won=false: 既に他の経路(通常完了/孤立ジョブ回収/スレッド削除等)で確定済みだった、
  // またはジョブ行自体が既に存在しない(スレッド削除で物理削除された等)。
  | { won: false };

// UPDATE(状態遷移)自体を1件も他へ委ねず、この関数内で発行したSQL・パラメータの
// 条件を満たした行だけを確定・返金する共通処理。呼び出し元がUPDATE文に埋め込む
// 条件(status IN (...)、あるいはorphan回収用のheartbeat/created_at鮮度条件)が、
// 「確定してよい」ことの唯一の判定根拠になる(SELECT時点の判定だけに頼ると、
// SELECT後にUPDATEするまでの間に状態が変わるTOCTOU競合を許してしまうため)。
function commitFinalize(
  id: string,
  updateSql: string,
  updateParams: SQLInputValue[],
  isRefundable: boolean,
): FinalizeRulingJobResult {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    const existing = db
      .prepare("SELECT device_id, usage_month_key FROM ruling_job WHERE id = ?")
      .get(id) as { device_id: string | null; usage_month_key: string | null } | undefined;

    const changes = db.prepare(updateSql).run(...updateParams).changes;

    if (!existing || changes === 0) {
      db.exec("COMMIT");
      return { won: false };
    }

    let refunded = false;
    if (existing.usage_month_key && existing.device_id && isRefundable) {
      decrementMonthlyUsage(existing.device_id, existing.usage_month_key);
      db.prepare("UPDATE ruling_job SET refunded_at = ? WHERE id = ?").run(now, id);
      refunded = true;
    }

    db.exec("COMMIT");
    if (refunded) {
      logger.info("ruling_job_quota_refunded", { jobId: id, deviceId: existing.device_id });
    }
    return { won: true, refunded, deviceId: existing.device_id };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * ジョブの確定(done/failed)と、条件を満たす場合の無料枠返金を1トランザクションで
 * 行う。原子的な状態遷移(status IN ('pending','running')条件でのUPDATE、更新件数で
 * 競合の勝ち負けを判定)により、同じジョブに対して複数の経路(通常完了・定期的な
 * 孤立ジョブ回収・スレッド削除)から同時に呼ばれても、確定処理・返金のいずれも
 * 二重に実行されない(Codexレビュー指摘、T010/T012設計を参照)。
 */
export function finalizeRulingJob(id: string, params: FinalizeRulingJobParams): FinalizeRulingJobResult {
  const now = Date.now();
  const updateSql =
    params.outcome === "done"
      ? `UPDATE ruling_job SET status = 'done', outcome_status = ?, result_json = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`
      : `UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`;
  const updateParams =
    params.outcome === "done"
      ? [params.outcomeStatus, JSON.stringify(params.result), now, id]
      : [params.error, now, id];
  return commitFinalize(id, updateSql, updateParams, isRefundableOutcome(params));
}

/**
 * T012 Review 8フォローアップ: 孤立ジョブ回収専用の確定処理。findStaleJobsでの
 * SELECT時点の判定だけに頼らず、UPDATE文自体に鮮度条件(pendingならcreated_at、
 * runningならheartbeat_atまたは〈heartbeatが無い旧デプロイ由来の行向けの〉
 * created_at)を埋め込むことで、SELECTからUPDATEまでの間に別プロセスが
 * heartbeatを更新して正常化したジョブを誤って確定してしまうTOCTOU競合を防ぐ。
 */
export function finalizeOrphanedRulingJob(
  id: string,
  guard:
    | { status: "pending"; createdBefore: number }
    | { status: "running"; heartbeatBefore: number; legacyCreatedBefore: number },
  errorMessage: string,
): FinalizeRulingJobResult {
  const now = Date.now();
  const updateSql =
    guard.status === "pending"
      ? `UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status = 'pending' AND created_at < ?`
      : `UPDATE ruling_job SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status = 'running'
           AND (
             (heartbeat_at IS NOT NULL AND heartbeat_at < ?)
             OR (heartbeat_at IS NULL AND created_at < ?)
           )`;
  const updateParams =
    guard.status === "pending"
      ? [errorMessage, now, id, guard.createdBefore]
      : [errorMessage, now, id, guard.heartbeatBefore, guard.legacyCreatedBefore];
  // 孤立ジョブ回収は常にoutcome="failed"相当(isRefundableOutcomeは"done"かつ"ok"の
  // 場合のみfalseを返すため、常にtrueで固定してよい)。
  return commitFinalize(id, updateSql, updateParams, true);
}

export function getJob(id: string): RulingJobRow | null {
  const row = db.prepare("SELECT * FROM ruling_job WHERE id = ?").get(id) as RulingJobRow | undefined;
  return row ?? null;
}

export function getJobsByThread(threadId: string): RulingJobRow[] {
  return db
    .prepare("SELECT * FROM ruling_job WHERE thread_id = ? ORDER BY created_at ASC")
    .all(threadId) as RulingJobRow[];
}

// ruling_job.thread_idにFK制約(ON DELETE CASCADE)が無いため、
// スレッド削除時はこの関数で明示的にジョブ側も削除する必要がある。
export function deleteJobsByThread(threadId: string): void {
  db.prepare("DELETE FROM ruling_job WHERE thread_id = ?").run(threadId);
}

// 完了/失敗から一定期間経過したジョブを削除する(ジョブ作成のたびに機会的に実行)。
// スレッドに紐づくジョブ(thread_id IS NOT NULL)はスレッド履歴として無期限保持し、
// スレッド化されていない孤立ジョブ(旧クライアント等でdeviceId未送信の場合)のみ対象とする。
export function pruneOldJobs(retentionMs: number): void {
  const threshold = Date.now() - retentionMs;
  db.prepare(
    `DELETE FROM ruling_job
     WHERE status IN ('done', 'failed')
       AND finished_at IS NOT NULL
       AND finished_at < ?
       AND thread_id IS NULL`,
  ).run(threshold);
}

const CORRECTION_TITLE_WITHOUT_JUDGE_ID = "過去の訂正事例(公認ジャッジによる記録)";
const LEGACY_CORRECTION_TITLE_PHRASE = "過去の訂正事例";

// T008: この関数の設計は汎用文字クラス→既知ID完全一致+負の先読み→文字列全体の
// 完全一致、と複数回変遷している。詳しい経緯・却下した設計とその理由は
// .ai/tasks/T008-correction-leak-quick-fix.mdのReview History参照(コード側には
// 現行の設計の説明のみを残す。Codexレビュー指摘、2026-09-04、round 18: 廃止した
// 方式の説明がコードに残ると、将来の修正者が現在の保証条件を誤認する原因になる)。
//
// 現在の設計: 既知のジャッジID値ごとに「旧titleの完全な文字列」(半角/全角括弧・
// コロン直後のスペース有無の4パターン)を構築し、文字列全体がそのいずれかと
// 完全一致する場合だけを置換対象とする。既知IDの値がどんな文字を含んでいても、
// 一致条件そのものが「この後に何も続かない」ことを含むため、「IDがどこで
// 終わるか」を推測する必要が一切無い。
//
// 旧titleが説明文などのより長い文字列に埋め込まれているケースは、この関数では
// 意図的に自動置換の対象外とする(unresolvedMarkerCountで検出され手動確認に
// 回る)。埋め込みケースまで部分文字列として置換する設計も検討したが、削除済みで
// 既知一覧(knownJudgeIds)から失われたIDが、別の現存する短いIDの前方一致に
// なっている場合、断片化した誤った置換が原理的に起こりうる(round 11・14と
// 同種の問題)。この関数はresult_json全件に対して常時・無条件に実行される
// ため、この残存リスクを許容できない。埋め込みケースは`findUnresolvedLegacyCorrectionTitleJobIds`
// (下記)で対象行のjobIdを特定した上で、運用者が手動でUPDATEする(round18〜21で
// 自動修復までを行う専用スクリプトを構築したが、対象が本番に実在する「たった
// 1行の過去データ」であることを踏まえ、そのために積み上げた安全性のコストは
// 見合わないとユーザー判断により撤回した。round22、2026-09-05)。
function buildLegacyTitles(knownJudgeIds: readonly string[]): Set<string> {
  const titles = new Set<string>();
  for (const id of knownJudgeIds) {
    titles.add(`過去の訂正事例(ジャッジID: ${id})`);
    titles.add(`過去の訂正事例(ジャッジID:${id})`);
    titles.add(`過去の訂正事例（ジャッジID: ${id}）`);
    titles.add(`過去の訂正事例（ジャッジID:${id}）`);
  }
  return titles;
}

/**
 * T008: retrieveEvidence.tsの旧title形式(`過去の訂正事例(ジャッジID: xxx)`)が
 * 過去にresult_jsonへ保存されたまま残っている場合、judgeIdを含まない表記へ置き換える。
 * result_jsonはJSON文字列のため、JSON.parseした値木を辿って文字列値ごとに判定する
 * (下記migrateLegacyCorrectionTitlesInValue参照。生のJSON文字列全体への正規表現
 * 適用はフィールド境界を破壊しうるため採用していない)。スレッド付きジョブは
 * 無期限保持されるため(pruneOldJobs参照)、この移行が無いと旧titleが残り続ける。
 * 1回限りの本番マイグレーション用。
 */
// JSON.parseした値木を再帰的に走査し、文字列値だけをlegacyTitles(既知ID値ごとの
// 完全一致する旧title文字列の集合、buildLegacyTitles参照)と比較する。生のJSON文字列
// 全体へ正規表現を適用すると、引用符・カンマ・フィールド境界を正規表現が
// 認識できないため、閉じ括弧を欠いたフィールドが後続の無関係なフィールドの
// 閉じ括弧まで飛び越えて置換してしまう危険がある(Codexレビュー指摘、2026-09-04)。
// JSON.parseで個々の文字列値へ分解してから比較することで、対象範囲が各フィールドの
// 内部に限定され、この危険を構造的に無くせる。
function migrateLegacyCorrectionTitlesInValue(
  value: unknown,
  legacyTitles: ReadonlySet<string>,
): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    // 文字列全体がlegacyTitlesのいずれかと完全一致する場合のみ置換する(上記
    // buildLegacyTitles参照)。一致した場合、置換対象は文字列全体そのものであり、
    // 部分文字列の書き換えは行わない(部分書き換えだとIDの終端をどこかで
    // 区切る必要があり、それこそがCodexレビューで指摘された構造的な弱点だったため)。
    if (!legacyTitles.has(value)) return { value, changed: false };
    return { value: CORRECTION_TITLE_WITHOUT_JUDGE_ID, changed: value !== CORRECTION_TITLE_WITHOUT_JUDGE_ID };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const updated = value.map((item) => {
      const result = migrateLegacyCorrectionTitlesInValue(item, legacyTitles);
      if (result.changed) changed = true;
      return result.value;
    });
    return { value: updated, changed };
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const entries: [string, unknown][] = [];
    for (const [key, child] of Object.entries(value)) {
      const result = migrateLegacyCorrectionTitlesInValue(child, legacyTitles);
      if (result.changed) changed = true;
      entries.push([key, result.value]);
    }
    // `{}`へのブラケット代入(updated[key] = ...)だと、キーが"__proto__"の場合に
    // 通常のプロパティ代入ではなくプロトタイプのsetterが呼ばれてしまい、そのキーが
    // 欠落したり生成オブジェクトのプロトタイプが変化したりする(Codexレビュー指摘、
    // 2026-09-04)。Object.fromEntries()はキーを常にown propertyとして設定するため、
    // "__proto__"というキーを含むJSONでもキーと値がそのまま保持される。
    return { value: Object.fromEntries(entries), changed };
  }
  return { value, changed: false };
}

// buildLegacyTitlesは既知の表記(半角/全角括弧、コロン直後のスペース有無)しか
// 対応しないが、これまで3種類の表記揺れで移行漏れを繰り返してきた実績があるため、
// この文字列置換だけでは「ジャッジIDが本当に1件も残っていない」ことを保証できない
// (Codexレビュー指摘、2026-09-04)。「ジャッジID」に相当する文字列そのもの
// (コロン等の付随記号を問わない、より広い部分一致)がまだ残っているかを別途
// チェックし、置換を試みても消えなかった行を確実に検出できるようにする。
//
// NFKC正規化してから判定することで、全角英数字(「ジャッジＩＤ」)・全角スペースを
// 半角相当へ揃え、さらに「ジャッジ」と「ID」の間の空白0文字以上、英語表記
// 「Judge ID」も許容する(Codexレビュー指摘、2026-09-04: 完全一致の「ジャッジID」
// だけでは、LLMが将来別の表記で言い換えた場合にunresolvedMarkerCountが0のまま
// 見逃してしまう)。
const JUDGE_MARKER = String.fromCharCode(0x30b8, 0x30e3, 0x30c3, 0x30b8); // "ジャッジ"
const JUDGE_ID_MARKER_PATTERN = new RegExp(`${JUDGE_MARKER}\\s*ID|Judge\\s*ID`, "i");

function containsJudgeIdMarker(value: unknown): boolean {
  if (typeof value === "string") return JUDGE_ID_MARKER_PATTERN.test(value.normalize("NFKC"));
  if (Array.isArray(value)) return value.some(containsJudgeIdMarker);
  if (value !== null && typeof value === "object") {
    // 値だけでなくキー自体も検査する(Codexレビュー指摘、2026-09-04):
    // JSONのキーにマーカーや既知ID値が紛れ込むケースは、現状のRulingResultの
    // 固定スキーマ(conclusion/explanation/sources等の静的なキー名のみ)では
    // 実際には起こらないが、将来の構造変更で動的なキー(ジャッジIDに由来する
    // ものを含む)が導入された場合に見逃さないための多層防御として追加する。
    return Object.entries(value).some(([key, child]) => JUDGE_ID_MARKER_PATTERN.test(key.normalize("NFKC")) || containsJudgeIdMarker(child));
  }
  return false;
}

// 「ジャッジID」というラベルの表記揺れをいくら追加しても、LLMが全く別の言い方
// (例:「公認ジャッジ番号」「審判ID」)で言い換えた場合は原理的に検出しきれない
// (Codexレビュー指摘、2026-09-04)。ラベルの表記に依存しない補助的な監査として、
// 実際に存在する(または存在した)ジャッジID自体の値がJSON内に文字列として
// 直接残っていないかを別途チェックする。
//
// **この監査結果はunresolvedMarkerCountとは別カウント(possibleKnownIdCollisionCount)
// で報告する(Codexレビュー指摘、2026-09-04: 既知IDが短い数値の場合、ルール番号・年・
// カード型番・URL等に偶然含まれる可能性が高く、実運用のジャッジID〈過去のインシデントで
// 実際に4桁数値だった〉では単純な部分文字列一致だと誤検知が起こりうるため、
// 「確定した表記揺れ残存」とは性質が異なる「要手動確認」として区別する)。ただし
// 誤検知の可能性を理由に無条件で成功扱いにはせず、1件以上あればCLIは非ゼロ終了する
// (呼び出し元のrunMigration参照)。自動置換もしない**。
// 全角数字等へ変形されたIDも検出できるよう、比較の両辺をNFKC正規化する
// (Codexレビュー指摘、2026-09-04: ラベル側のcontainsJudgeIdMarkerと同様)。
function textMatchesAnyKnownJudgeId(text: string, knownJudgeIds: readonly string[]): boolean {
  const normalized = text.normalize("NFKC");
  return knownJudgeIds.some((id) => normalized.includes(id.normalize("NFKC")));
}

function containsAnyKnownJudgeId(value: unknown, knownJudgeIds: readonly string[]): boolean {
  if (knownJudgeIds.length === 0) return false;
  if (typeof value === "string") return textMatchesAnyKnownJudgeId(value, knownJudgeIds);
  if (Array.isArray(value)) return value.some((item) => containsAnyKnownJudgeId(item, knownJudgeIds));
  if (value !== null && typeof value === "object") {
    // 値だけでなくキー自体も検査する(Codexレビュー指摘、2026-09-04。
    // containsJudgeIdMarkerと同様の多層防御、詳細はそちらのコメント参照)。
    return Object.entries(value).some(
      ([key, child]) => textMatchesAnyKnownJudgeId(key, knownJudgeIds) || containsAnyKnownJudgeId(child, knownJudgeIds),
    );
  }
  return false;
}

export type MigrateLegacyCorrectionTitlesResult = {
  migrated: number;
  // 置換を試みても「ジャッジID」相当の表記(containsJudgeIdMarker参照)がまだ
  // 残っている行の件数。既知の旧title文字列(buildLegacyTitles参照)では対応
  // できない未知の表記揺れが残っていることを意味する。CLIの終了コードはこの
  // 件数に基づいて非ゼロになる。
  unresolvedMarkerCount: number;
  // result_jsonがJSONとして解析できなかった行の件数(内容不明のため、ジャッジIDの
  // 有無を判定できない)。表記揺れとは原因が異なるため別カウントで報告する
  // (Codexレビュー指摘、2026-09-04: 混在させると無関係な破損JSONが1件あるだけで
  // 「ジャッジID残存」と誤解される)。CLIの終了コードはこの件数にも基づく。
  invalidJsonCount: number;
  // 既知のジャッジID値そのものと一致した行の件数。unresolvedMarkerCountとは
  // 独立に集計するため、同じ行でラベルも既知ID値も両方検出された場合は両方の
  // カウントに計上される(Codexレビュー指摘、2026-09-04、round 14: else ifだと
  // 片方が欠落し、手動調査に必要な情報が失われるため)。誤検知が多いため確定した
  // 表記揺れ残存とは別カウントで報告するが、1件以上あれば呼び出し元(runMigration)は
  // 非ゼロ終了にし、手動での目視確認を必須とする(上記containsAnyKnownJudgeIdの
  // コメント参照)。
  possibleKnownIdCollisionCount: number;
};

// jobIdそのものは戻り値に含めない(Codexレビュー指摘、2026-09-04): 未解決行は
// まだジャッジIDが残っている(または内容不明の)行を指すため、そのjobIdを個別に
// 開示すると、認証不要の`GET /api/ruling/jobs/:jobId`から直接その内容を取得できて
// しまう新たな開示経路になる。件数が1件でもあれば呼び出し元は成功扱いにせず報告する
// 必要があるが、個別調査は本番DBを直接クエリして行う。
//
// knownJudgeIds: 呼び出し元(corrections/repository.ts)が`judge`・`correction`
// テーブルから集めた、現在または過去に実在したジャッジIDの値そのもの。
// `buildLegacyTitles`(旧title文字列の構築、自動置換対象の決定)と
// `containsAnyKnownJudgeId`(自動置換後もIDの値自体が残っていないかの補助監査、
// possibleKnownIdCollisionCount)の両方に使う(Codexレビュー指摘、2026-09-04、
// round 16: 「参考情報としてのみ使用」という旧い記述は自動置換にも使われる
// 実態と食い違っていたため訂正)。
export function migrateLegacyCorrectionTitlesInResultJson(
  knownJudgeIds: readonly string[] = [],
): MigrateLegacyCorrectionTitlesResult {
  // Unicodeエスケープ(例: JSON内に文字通り"ジ..."と保存されている場合)は
  // JSON.parse後でなければ「ジャッジID」に一致しないため、SQL側のLIKEで絞り込むと
  // 検出漏れが生じる(Codexレビュー指摘、2026-09-04)。本番のruling_job件数は
  // 1回限りのマイグレーションとして許容できる規模のため、絞り込まず全件を
  // JSON.parseしてから判定する。
  const rows = db.prepare("SELECT id, result_json FROM ruling_job WHERE result_json IS NOT NULL").all() as {
    id: string;
    result_json: string | null;
  }[];
  const legacyTitles = buildLegacyTitles(knownJudgeIds);

  let migrated = 0;
  let unresolvedMarkerCount = 0;
  let invalidJsonCount = 0;
  let possibleKnownIdCollisionCount = 0;
  for (const row of rows) {
    if (!row.result_json) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result_json);
    } catch {
      // 解析できないJSONは安全側に倒してスキップする(壊れたJSONで上書きしない)。
      // jobId・エラーメッセージ本文はログへ出さない(Codexレビュー指摘: エラー
      // メッセージが元の文字列断片を含みうる上、jobIdは上記の理由により機微)。
      logger.error("legacy_correction_title_migration_json_parse_failed", {});
      invalidJsonCount++;
      continue;
    }

    const { value: migratedValue, changed } = migrateLegacyCorrectionTitlesInValue(parsed, legacyTitles);
    if (changed) {
      db.prepare("UPDATE ruling_job SET result_json = ? WHERE id = ?").run(JSON.stringify(migratedValue), row.id);
      migrated++;
    }

    // 2つの検査は独立したif(else ifではない)にする(Codexレビュー指摘、2026-09-04、
    // round 14): 同じ行に「未解決のラベル」と「別箇所の既知ID値」が両方残っている
    // 場合、else ifだとpossibleKnownIdCollisionCountが計上されず、手動調査に
    // 必要な情報(この行には既知ID値も残っている)が欠落してしまう。
    if (containsJudgeIdMarker(migratedValue)) {
      // 置換を試みた(またはそもそも既知パターンに一致せず未置換だった)後も、
      // ラベルが残っている。jobIdはログへ出さない(上記参照)。
      unresolvedMarkerCount++;
    }
    if (containsAnyKnownJudgeId(migratedValue, knownJudgeIds)) {
      // 既知のID値そのものと一致した。誤検知が多いため参考情報として別カウントに
      // 留める(上記possibleKnownIdCollisionCountのコメント参照)。
      possibleKnownIdCollisionCount++;
    }
  }
  if (unresolvedMarkerCount > 0 || invalidJsonCount > 0) {
    logger.error("legacy_correction_title_migration_unresolved", { unresolvedMarkerCount, invalidJsonCount });
  }
  if (possibleKnownIdCollisionCount > 0) {
    logger.warn("legacy_correction_title_migration_possible_known_id_collision", { possibleKnownIdCollisionCount });
  }
  return { migrated, unresolvedMarkerCount, invalidJsonCount, possibleKnownIdCollisionCount };
}

// T008: migrateLegacyCorrectionTitlesInResultJsonは、旧titleが説明文などへ
// 埋め込まれているケース(フィールド値全体との完全一致ではないケース)を
// 意図的に自動置換しない(上記のコメント参照: 削除済みIDとの前方一致による
// 誤った断片化置換を、常時実行される移行処理では許容できないため)。
//
// round18〜21では、この関数が`unresolvedMarkerCount`として報告した少数の行を
// 自動で修復する専用復旧スクリプト(部分置換→フィールド値全体の非表示化→
// 検証トークンによるTOCTOU対策、と設計を重ねた)を構築したが、対象は本番に
// 実在する「たった1行の過去データ」であり、そのために積み上げた安全性のコスト
// (境界推測の排除・暗号学的検証トークン・多層のテスト)は見合わないとユーザー
// 判断により撤回した(2026-09-05)。この関数は診断専用(該当行のjobId一覧を
// 返すだけ)に留め、実際の修復は運用者がRender Web Shellから対象jobIdを直接
// 指定してUPDATEする(手順は.ai/tasks/T008-correction-leak-quick-fix.mdの
// 「残作業」参照)。
//
// jobIdの扱いについて(Codexレビュー指摘、2026-09-05、round22): jobIdは
// `randomUUID()`(`src/routes/rulingJobs.ts`)で生成される推測困難な値だが、
// 認証不要`GET /api/ruling/jobs/:jobId`がジャッジIDを含む対象結果への
// アクセスキーとして機能するため、「非機微情報」と断定することはできない。
// このスクリプトの出力はRender Web Shellの画面上に運用者本人が一時的に
// 表示するだけの用途に限り、タスク文書・レビュープロンプト・チャット等
// 恒久的に残る場所へは書き写さないことを前提に、このリスクを受容する
// (このタスクで過去に2回発生した転記漏洩はいずれもジャッジID自体の
// 転記であり、jobId〈推測困難なUUID〉の一時表示とは性質が異なる)。
//
// 診断条件について(Codexレビュー指摘、2026-09-05、round22): 単に
// `containsJudgeIdMarker`(「ジャッジID」ラベルの表記揺れ検出、通常移行の
// unresolvedMarkerCount算出にも使う汎用関数)だけを条件にすると、「ジャッジID
// は回答に含めないでください」のような無害な文章まで候補に含まれてしまう。
// 手動UPDATEはresult_json全体を非表示結果へ置き換えるため、無害な行を候補に
// 含めてしまうと、その行を誤って壊しうる。旧titleのラベルは必ず「過去の訂正
// 事例」という固定フレーズと隣接して使われるため、この専用診断では両方が
// 同一の文字列値内に共存することを要求する、より狭い条件を使う。
function containsEmbeddedLegacyCorrectionTitleMarker(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.normalize("NFKC");
    return normalized.includes(LEGACY_CORRECTION_TITLE_PHRASE) && JUDGE_ID_MARKER_PATTERN.test(normalized);
  }
  if (Array.isArray(value)) return value.some(containsEmbeddedLegacyCorrectionTitleMarker);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsEmbeddedLegacyCorrectionTitleMarker);
  }
  return false;
}

export function findUnresolvedLegacyCorrectionTitleJobIds(): string[] {
  const rows = db.prepare("SELECT id, result_json FROM ruling_job WHERE result_json IS NOT NULL").all() as {
    id: string;
    result_json: string | null;
  }[];

  const jobIds: string[] = [];
  for (const row of rows) {
    if (!row.result_json) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result_json);
    } catch {
      // 解析できない行はmigrateLegacyCorrectionTitlesInResultJson側の
      // invalidJsonCountで既に報告済みのため、ここでは対象外とする。
      continue;
    }
    if (containsEmbeddedLegacyCorrectionTitleMarker(parsed)) {
      jobIds.push(row.id);
    }
  }
  return jobIds;
}
