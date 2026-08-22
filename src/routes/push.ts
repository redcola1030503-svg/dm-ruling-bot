import { Router } from "express";
import { z } from "zod";
import { deleteToken, upsertToken } from "../push/pushTokenRepository";
import { pushRegisterRateLimiter } from "../utils/rateLimit";

export const pushRouter = Router();

const registerTokenSchema = z.object({
  deviceId: z.string().min(1).max(200),
  fcmToken: z.string().min(1).max(4096),
  platform: z.string().min(1).max(20).default("android"),
});

pushRouter.post("/api/push/register-token", pushRegisterRateLimiter, (req, res) => {
  const parsed = registerTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  upsertToken(parsed.data.deviceId, parsed.data.fcmToken, parsed.data.platform);
  res.status(204).send();
});

const deviceIdParamSchema = z.object({
  deviceId: z.string().min(1).max(200),
});

pushRouter.delete(
  "/api/push/register-token/:deviceId",
  pushRegisterRateLimiter,
  (req, res) => {
    const parsed = deviceIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    deleteToken(parsed.data.deviceId);
    res.status(204).send();
  },
);
