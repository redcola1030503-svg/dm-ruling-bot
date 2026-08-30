import { env } from "../config/env";

export type RulingAccessInput = {
  jobCountThisMonth: number;
  activeUntilMs: number | null;
  nowMs: number;
};

export type RulingAccessResult = {
  allowed: boolean;
  remainingFree: number;
};

export function evaluateRulingAccess(input: RulingAccessInput): RulingAccessResult {
  const { jobCountThisMonth, activeUntilMs, nowMs } = input;
  const remainingFree = Math.max(0, env.RULING_FREE_MONTHLY_LIMIT - jobCountThisMonth);
  const hasActiveSubscription = activeUntilMs !== null && activeUntilMs > nowMs;
  const withinFreeLimit = jobCountThisMonth < env.RULING_FREE_MONTHLY_LIMIT;

  return {
    allowed: withinFreeLimit || hasActiveSubscription,
    remainingFree,
  };
}
