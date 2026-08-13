import { initializeApp, cert, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let app: App | null = null;

if (env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
  try {
    const json = JSON.parse(
      Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf-8"),
    );
    app = initializeApp({ credential: cert(json) });
  } catch (error) {
    logger.error("fcm_init_failed", { error: error instanceof Error ? error.message : String(error) });
  }
} else {
  logger.warn("fcm_not_configured", {});
}

export function isPushConfigured(): boolean {
  return app !== null;
}

export type SendPushResult = { ok: boolean; shouldRemoveToken: boolean };

export async function sendPushNotification(params: {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<SendPushResult> {
  if (!app) return { ok: false, shouldRemoveToken: false };

  try {
    await getMessaging(app).send({
      token: params.token,
      notification: { title: params.title, body: params.body },
      data: params.data,
      android: { priority: "high" },
    });
    return { ok: true, shouldRemoveToken: false };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    const isInvalidToken =
      code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token";
    logger.error("fcm_send_failed", { code, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, shouldRemoveToken: isInvalidToken };
  }
}
