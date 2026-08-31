import { describe, expect, it } from "vitest";
import { evaluateRulingAccess } from "../src/billing/accessControl";

const FREE_LIMIT = 10;
const now = Date.now();

describe("evaluateRulingAccess", () => {
  it("無料枠内(件数<上限)かつ未購読なら許可し、残り回数を返す", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 3, activeUntilMs: null, nowMs: now });
    expect(result).toEqual({ allowed: true, remainingFree: FREE_LIMIT - 3, hasActiveSubscription: false });
  });

  it("無料枠ちょうど(件数=上限)かつ未購読なら不許可、残り回数は0", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 10, activeUntilMs: null, nowMs: now });
    expect(result).toEqual({ allowed: false, remainingFree: 0, hasActiveSubscription: false });
  });

  it("購読が有効(active_untilが未来)ならhasActiveSubscriptionはtrue(PR #1レビュー指摘P1対応: 購読中は無料枠カウンタを消費しない判定に使う)", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 3, activeUntilMs: now + 1000, nowMs: now });
    expect(result.hasActiveSubscription).toBe(true);
  });

  it("購読が無い(activeUntilMsがnull)ならhasActiveSubscriptionはfalse", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 3, activeUntilMs: null, nowMs: now });
    expect(result.hasActiveSubscription).toBe(false);
  });

  it("購読が失効済み(active_untilが過去)ならhasActiveSubscriptionはfalse", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 3, activeUntilMs: now - 1000, nowMs: now });
    expect(result.hasActiveSubscription).toBe(false);
  });

  it("無料枠超過でも購読が有効(active_untilが未来)なら許可", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 25, activeUntilMs: now + 1000, nowMs: now });
    expect(result.allowed).toBe(true);
  });

  it("無料枠超過かつ購読が失効済み(active_untilが過去)なら不許可", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 25, activeUntilMs: now - 1000, nowMs: now });
    expect(result.allowed).toBe(false);
  });

  it("無料枠内なら購読が失効済みでも許可(無料枠は購読の有無と独立)", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 0, activeUntilMs: now - 1000, nowMs: now });
    expect(result.allowed).toBe(true);
  });
});
