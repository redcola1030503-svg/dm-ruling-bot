import { db } from "../config/db";

export function getActiveUntil(deviceId: string): number | null {
  const row = db.prepare("SELECT active_until FROM device_subscription WHERE device_id = ?").get(deviceId) as
    | { active_until: number }
    | undefined;
  return row ? row.active_until : null;
}

export function setActiveUntil(deviceId: string, activeUntilMs: number): void {
  db.prepare(
    `INSERT INTO device_subscription (device_id, active_until, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET active_until = excluded.active_until, updated_at = excluded.updated_at`,
  ).run(deviceId, activeUntilMs, Date.now());
}
