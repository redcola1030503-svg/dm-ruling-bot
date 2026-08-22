import { Router } from "express";
import { z } from "zod";
import { sendPushNotification } from "../push/fcm";
import { deleteToken, getToken, upsertToken } from "../push/pushTokenRepository";
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

const sendTestSchema = z.object({
  deviceId: z.string().min(1).max(200),
});

pushRouter.post(
  "/api/push/send-test",
  pushRegisterRateLimiter,
  async (req, res) => {
    const parsed = sendTestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const token = getToken(parsed.data.deviceId);
    if (!token) {
      res.status(404).json({ error: "push_token_not_found" });
      return;
    }

    const result = await sendPushNotification({
      token,
      title: "テスト通知",
      body: "この通知が届いていれば、プッシュ通知は正常に動作しています。",
      data: {},
    });

    if (!result.ok) {
      if (result.shouldRemoveToken) {
        deleteToken(parsed.data.deviceId);
      }
      res.status(502).json({ error: "push_send_failed" });
      return;
    }

    res.status(204).send();
  },
);
