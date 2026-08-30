import { Router } from "express";
import { z } from "zod";
import { verifyWebhookAuthorization, applyEntitlement, fetchCustomerEntitlementExpiry } from "../billing/revenueCat";
import { getActiveUntil } from "../billing/deviceSubscriptionRepository";
import { countJobsThisMonth } from "../ruling/rulingJobRepository";
import { evaluateRulingAccess } from "../billing/accessControl";
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

billingRouter.post("/api/billing/revenuecat-webhook", billingRateLimiter, (req, res) => {
  if (!verifyWebhookAuthorization(req.header("authorization"))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = webhookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    // RevenueCatに再送されても困る不正ペイロードのため200で受理しログのみ残す。
    logger.warn("revenuecat_webhook_invalid_payload", { details: parsed.error.flatten() });
    res.status(200).json({ status: "ignored" });
    return;
  }

  const { app_user_id: appUserId, expiration_at_ms: expiresAtMs, type } = parsed.data.event;
  applyEntitlement(appUserId, expiresAtMs ?? null);
  logger.info("revenuecat_webhook_applied", { appUserId, type, expiresAtMs });
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
  const jobCountThisMonth = countJobsThisMonth(parsed.data.deviceId, now);
  const activeUntilMs = getActiveUntil(parsed.data.deviceId);
  const { allowed, remainingFree } = evaluateRulingAccess({ jobCountThisMonth, activeUntilMs, nowMs: now });

  res.json({
    remainingFree,
    subscriptionActive: activeUntilMs !== null && activeUntilMs > now,
    canAskQuestion: allowed,
  });
});
