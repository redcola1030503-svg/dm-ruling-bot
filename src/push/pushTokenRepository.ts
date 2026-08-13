import { db } from "../config/db";

export function upsertToken(deviceId: string, fcmToken: string, platform: string): void {
  db.prepare(
    `INSERT INTO device_push_token (device_id, fcm_token, platform, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET fcm_token = excluded.fcm_token, platform = excluded.platform, updated_at = excluded.updated_at`,
  ).run(deviceId, fcmToken, platform, Date.now());
}

export function getToken(deviceId: string): string | null {
  const row = db.prepare("SELECT fcm_token FROM device_push_token WHERE device_id = ?").get(deviceId) as
    | { fcm_token: string }
    | undefined;
  return row ? row.fcm_token : null;
}

export function deleteToken(deviceId: string): void {
  db.prepare("DELETE FROM device_push_token WHERE device_id = ?").run(deviceId);
}
