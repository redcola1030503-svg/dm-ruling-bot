import { describe, expect, it } from "vitest";
import {
  isApplicableEventType,
  isRevocationEventType,
  shouldApplyEntitlementUpdate,
} from "../src/billing/revenueCatEventPolicy";

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

describe("isRevocationEventType", () => {
  it("EXPIRATION/REFUNDはtrueを返す(REST APIからの再取得が必要なイベント種別)", () => {
    expect(isRevocationEventType("EXPIRATION")).toBe(true);
    expect(isRevocationEventType("REFUND")).toBe(true);
  });

  it("それ以外の適用可能イベントはfalseを返す", () => {
    expect(isRevocationEventType("RENEWAL")).toBe(false);
    expect(isRevocationEventType("CANCELLATION")).toBe(false);
    expect(isRevocationEventType("INITIAL_PURCHASE")).toBe(false);
  });
});

describe("shouldApplyEntitlementUpdate", () => {
  it("新規購入で現在値より新しいexpiresAtMsならtrue", () => {
    expect(
      shouldApplyEntitlementUpdate({ expiresAtMs: 2000, currentActiveUntil: 1000, isFreshFromApi: false }),
    ).toBe(true);
  });

  it("RENEWAL到達後に遅延したCANCELLATION(現在値より古いexpiresAtMs)はfalse(巻き戻り防止)", () => {
    expect(
      shouldApplyEntitlementUpdate({ expiresAtMs: 1000, currentActiveUntil: 5000, isFreshFromApi: false }),
    ).toBe(false);
  });

  it("expiresAtMsがnull(RevenueCat側にエンタイトルメント無し)の場合は常にtrue", () => {
    expect(
      shouldApplyEntitlementUpdate({ expiresAtMs: null, currentActiveUntil: 5000, isFreshFromApi: false }),
    ).toBe(true);
  });

  it("expiresAtMsが現在値と同じ(新しくない)場合はfalse", () => {
    expect(
      shouldApplyEntitlementUpdate({ expiresAtMs: 5000, currentActiveUntil: 5000, isFreshFromApi: false }),
    ).toBe(false);
  });

  it(
    "isFreshFromApiがfalse(webhookペイロードの値をそのまま使う)場合、" +
      "現在値より古いexpiresAtMsは適用しない(PR #1レビュー指摘P1対応: " +
      "RENEWAL適用後に遅延到着したEXPIRATION/REFUNDが新しい更新状態を巻き戻すバグの修正)",
    () => {
      expect(
        shouldApplyEntitlementUpdate({ expiresAtMs: 1000, currentActiveUntil: 5000, isFreshFromApi: false }),
      ).toBe(false);
    },
  );

  it(
    "isFreshFromApiがtrue(RevenueCat REST APIから直接取得した権威的な値)の場合、" +
      "現在値より古くても常に適用する(遅延webhookの到着順序に依存しないため)",
    () => {
      expect(
        shouldApplyEntitlementUpdate({ expiresAtMs: 1000, currentActiveUntil: 5000, isFreshFromApi: true }),
      ).toBe(true);
    },
  );
});
