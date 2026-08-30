import { Router } from "express";
import { z } from "zod";
import { verifyWebhookAuthorization, applyEntitlement, fetchCustomerEntitlementExpiry } from "../billing/revenueCat";
import { getActiveUntil } from "../billing/deviceSubscriptionRepository";
import { getMonthlyUsageCount } from "../billing/deviceMonthlyUsageRepository";
import { evaluateRulingAccess } from "../billing/accessControl";
import { isApplicableEventType, shouldApplyEntitlementUpdate } from "../billing/revenueCatEventPolicy";
import { billingRateLimiter } from "../utils/rateLimit";
import { logger } from "../utils/logger";

export const billingRouter = Router();

const webhookEventSchema = z.object({
  event: z.object({
    type: z.string(),
    app_user_id: z.string(),
    expiration_at_ms: z.number().nullable().optional(),
  }),
});

billingRouter.post("/api/billing/revenuecat-webhook", billingRateLimiter, async (req, res) => {
  if (!verifyWebhookAuthorization(req.header("authorization"))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = webhookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("revenuecat_webhook_invalid_payload", { details: parsed.error.flatten() });
    res.status(200).json({ status: "ignored" });
    return;
  }

  const { app_user_id: appUserId, expiration_at_ms: expiresAtMsFromEvent, type } = parsed.data.event;

  if (!isApplicableEventType(type)) {
    logger.info("revenuecat_webhook_ignored_type", { appUserId, type });
    res.status(200).json({ status: "ignored" });
    return;
  }

  let expiresAtMs = expiresAtMsFromEvent ?? null;
  if (expiresAtMs === null) {
    try {
      expiresAtMs = await fetchCustomerEntitlementExpiry(appUserId);
    } catch (error) {
      // RevenueCatへの問い合わせに失敗した場合、購読状態を誤って
      // 書き換えるより再送に賭けたほうが安全なため502で応答し、
      // RevenueCat側の再送に任せる。
      logger.error("revenuecat_webhook_lookup_failed", {
        appUserId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(502).json({ error: "lookup_failed" });
      return;
    }
  }

  // RENEWAL到達後に遅延したCANCELLATION(古い有効期限を持つ)等で購読状態が
  // 巻き戻らないよう、明示的な失効(EXPIRATION/REFUND)以外は現在値より
  // 新しい場合のみ書き込む(判定ロジックはbilling/revenueCatEventPolicy.tsで単体テスト済み)。
  const currentActiveUntil = getActiveUntil(appUserId) ?? 0;
  const shouldWrite = shouldApplyEntitlementUpdate({ type, expiresAtMs, currentActiveUntil });

  if (shouldWrite) {
    applyEntitlement(appUserId, expiresAtMs);
    logger.info("revenuecat_webhook_applied", { appUserId, type, expiresAtMs });
  } else {
    logger.info("revenuecat_webhook_stale_ignored", { appUserId, type, expiresAtMs, currentActiveUntil });
  }

  res.status(200).json({ status: "ok" });
});

const syncSchema = z.object({
  deviceId: z.string().min(1).max(200),
});

billingRouter.post("/api/billing/sync", billingRateLimiter, async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  try {
    const expiresAtMs = await fetchCustomerEntitlementExpiry(parsed.data.deviceId);
    applyEntitlement(parsed.data.deviceId, expiresAtMs);
    res.status(204).send();
  } catch (error) {
    logger.error("revenuecat_sync_failed", {
      deviceId: parsed.data.deviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: "sync_failed" });
  }
});

const usageQuerySchema = z.object({
  deviceId: z.string().min(1).max(200),
});

billingRouter.get("/api/ruling/usage", (req, res) => {
  const parsed = usageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const now = Date.now();
  const jobCountThisMonth = getMonthlyUsageCount(parsed.data.deviceId, now);
  const activeUntilMs = getActiveUntil(parsed.data.deviceId);
  const { allowed, remainingFree } = evaluateRulingAccess({ jobCountThisMonth, activeUntilMs, nowMs: now });

  res.json({
    remainingFree,
    subscriptionActive: activeUntilMs !== null && activeUntilMs > now,
    canAskQuestion: allowed,
  });
});
