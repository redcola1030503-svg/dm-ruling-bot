// RevenueCat Webhookの各イベント種別をどう扱うかを決める純粋ロジック。
// I/O(DB読み書き・RevenueCat REST API呼び出し)を含まないため、
// ルートハンドラー(src/routes/billing.ts)から切り離して単体テストする。

// 明示的な失効イベント。webhookペイロード自身のexpiration_at_msは古い期間を
// 指している可能性があるため、これらの種別はルート側でRevenueCat REST APIから
// 現在のエンタイトルメントを再取得してから渡す(shouldApplyEntitlementUpdateの
// isFreshFromApi引数を参照)。
const REVOCATION_EVENT_TYPES = new Set(["EXPIRATION", "REFUND"]);

// 反映してよいイベント種別のみを許可する。ここに無いtype(エイリアス統合・
// テストイベント・将来追加される未知の種別等)は無視する
// (無条件に書き込むと、expiration_at_msを持たないイベントで誤って
// active_untilを0にしてしまい、正規の購読者のアクセスを剥奪しかねないため)。
const APPLICABLE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
  "UNCANCELLATION",
  "REFUND",
]);

export function isApplicableEventType(type: string): boolean {
  return APPLICABLE_EVENT_TYPES.has(type);
}

export function isRevocationEventType(type: string): boolean {
  return REVOCATION_EVENT_TYPES.has(type);
}

// RENEWAL到達後に遅延したCANCELLATION等でactive_untilが巻き戻らないよう、
// isFreshFromApiがfalse(webhookペイロードの値をそのまま使う)場合は現在値より
// 新しい場合のみ書き込みを許可する。isFreshFromApiがtrue(RevenueCat REST APIから
// 直接取得した権威的な値)の場合は、webhookの到着順序に依存しないため現在値より
// 古くても常に書き込みを許可する(EXPIRATION/REFUNDはルート側で必ずREST再取得
// してからこの関数を呼ぶため、遅延到着で新しい更新状態を巻き戻す問題が起きない)。
// expiresAtMsがnull(エンタイトルメント無し)の場合は明示的な失効として扱い、
// 常に書き込みを許可する。
export function shouldApplyEntitlementUpdate(input: {
  expiresAtMs: number | null;
  currentActiveUntil: number;
  isFreshFromApi: boolean;
}): boolean {
  const { expiresAtMs, currentActiveUntil, isFreshFromApi } = input;
  if (isFreshFromApi) return true;
  return expiresAtMs === null || expiresAtMs > currentActiveUntil;
}
