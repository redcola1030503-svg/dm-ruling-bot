// RevenueCat Webhookの各イベント種別をどう扱うかを決める純粋ロジック。
// I/O(DB読み書き・RevenueCat REST API呼び出し)を含まないため、
// ルートハンドラー(src/routes/billing.ts)から切り離して単体テストする。

// 明示的な失効イベント。これらは常にactive_untilへ反映してよい
// (現在値より古い有効期限であっても、失効という事実自体を優先する)。
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

// RENEWAL到達後に遅延したCANCELLATION(古い有効期限を持つ)等でactive_untilが
// 巻き戻らないよう、明示的な失効(EXPIRATION/REFUND)以外は現在値より新しい
// 場合のみ書き込みを許可する。expiresAtMsがnull(エンタイトルメント無し)の
// 場合は明示的な失効として扱い、常に書き込みを許可する。
export function shouldApplyEntitlementUpdate(input: {
  type: string;
  expiresAtMs: number | null;
  currentActiveUntil: number;
}): boolean {
  const { type, expiresAtMs, currentActiveUntil } = input;
  const isRevocation = REVOCATION_EVENT_TYPES.has(type);
  return isRevocation || expiresAtMs === null || expiresAtMs > currentActiveUntil;
}
