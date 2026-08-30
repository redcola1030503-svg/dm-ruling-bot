import { timingSafeEqual } from "node:crypto";
import axios from "axios";
import { env } from "../config/env";
import { setActiveUntil } from "./deviceSubscriptionRepository";

// RevenueCatダッシュボードでWebhookに設定した「Authorization header value」と
// 一致するかを定数時間比較で検証する。長さが異なる場合はtimingSafeEqualが
// 例外を投げるため、先に長さを揃えてから比較する。
export function verifyWebhookAuthorization(headerValue: string | undefined): boolean {
  if (!env.REVENUECAT_WEBHOOK_SECRET || !headerValue) return false;
  const expected = Buffer.from(env.REVENUECAT_WEBHOOK_SECRET);
  const actual = Buffer.from(headerValue);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// expiresAtMsがnull(エンタイトルメント無し)の場合は0(1970年)を設定し、
// 以後のevaluateRulingAccessで確実に「未購読」として扱われるようにする。
export function applyEntitlement(appUserId: string, expiresAtMs: number | null): void {
  setActiveUntil(appUserId, expiresAtMs ?? 0);
}

// RevenueCatのREST API(GetCustomerInfo)。フィールド名は実装時点のドキュメント
// (https://www.revenuecat.com/docs/api-v1#tag/customers)に基づく。API仕様が
// 変わっている場合はこの関数のパース部分のみ修正すればよい。
export async function fetchCustomerEntitlementExpiry(appUserId: string): Promise<number | null> {
  const response = await axios.get(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${env.REVENUECAT_API_KEY}` } },
  );
  const entitlement = response.data?.subscriber?.entitlements?.[env.REVENUECAT_ENTITLEMENT_ID];
  if (!entitlement?.expires_date) return null;
  return Date.parse(entitlement.expires_date);
}
