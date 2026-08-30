import { describe, expect, it } from "vitest";
import { isApplicableEventType, shouldApplyEntitlementUpdate } from "../src/billing/revenueCatEventPolicy";

describe("isApplicableEventType", () => {
  it("既知の課金イベント種別はtrueを返す", () => {
    for (const type of [
      "INITIAL_PURCHASE",
      "RENEWAL",
      "PRODUCT_CHANGE",
      "CANCELLATION",
      "EXPIRATION",
      "BILLING_ISSUE",
      "UNCANCELLATION",
      "REFUND",
    ]) {
      expect(isApplicableEventType(type)).toBe(true);
    }
  });

  it("未知のイベント種別(エイリアス統合・テストイベント等)はfalseを返す", () => {
    expect(isApplicableEventType("TRANSFER")).toBe(false);
    expect(isApplicableEventType("TEST")).toBe(false);
    expect(isApplicableEventType("SOME_FUTURE_EVENT_TYPE")).toBe(false);
  });
});

describe("shouldApplyEntitlementUpdate", () => {
  it("新規購入で現在値より新しいexpiresAtMsならtrue", () => {
    expect(
      shouldApplyEntitlementUpdate({ type: "INITIAL_PURCHASE", expiresAtMs: 2000, currentActiveUntil: 1000 }),
    ).toBe(true);
  });

  it("RENEWAL到達後に遅延したCANCELLATION(現在値より古いexpiresAtMs)はfalse(巻き戻り防止)", () => {
    expect(
      shouldApplyEntitlementUpdate({ type: "CANCELLATION", expiresAtMs: 1000, currentActiveUntil: 5000 }),
    ).toBe(false);
  });

  it("RENEWALで現在値より古いexpiresAtMs(遅延到達)はfalse", () => {
    expect(
      shouldApplyEntitlementUpdate({ type: "RENEWAL", expiresAtMs: 3000, currentActiveUntil: 5000 }),
    ).toBe(false);
  });

  it("EXPIRATION(明示的な失効)は現在値より古いexpiresAtMsでもtrue", () => {
    expect(
      shouldApplyEntitlementUpdate({ type: "EXPIRATION", expiresAtMs: 1000, currentActiveUntil: 5000 }),
    ).toBe(true);
  });

  it("REFUND(明示的な失効)は現在値より古いexpiresAtMsでもtrue", () => {
    expect(shouldApplyEntitlementUpdate({ type: "REFUND", expiresAtMs: 0, currentActiveUntil: 5000 })).toBe(
      true,
    );
  });

  it("expiresAtMsがnull(RevenueCat側にエンタイトルメント無し)の場合は常にtrue", () => {
    expect(
      shouldApplyEntitlementUpdate({ type: "BILLING_ISSUE", expiresAtMs: null, currentActiveUntil: 5000 }),
    ).toBe(true);
  });

  it("expiresAtMsが現在値と同じ(新しくない)場合はfalse", () => {
    expect(
      shouldApplyEntitlementUpdate({ type: "RENEWAL", expiresAtMs: 5000, currentActiveUntil: 5000 }),
    ).toBe(false);
  });
});
