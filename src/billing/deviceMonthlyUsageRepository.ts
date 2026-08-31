import { db } from "../config/db";

function monthKeyFor(nowMs: number): string {
  const now = new Date(nowMs);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

// スレッド削除等でruling_jobの行が消えても無料枠のカウントが減らないよう、
// 独立した増分専用のカウンタとして持つ(ruling_jobの行数を数える方式だと
// スレッド削除で無料枠が復活してしまうため)。
export function incrementMonthlyUsage(deviceId: string, nowMs: number): void {
  const monthKey = monthKeyFor(nowMs);
  db.prepare(
    `INSERT INTO device_monthly_usage (device_id, month_key, count)
     VALUES (?, ?, 1)
     ON CONFLICT(device_id, month_key) DO UPDATE SET count = count + 1`,
  ).run(deviceId, monthKey);
}

export function getMonthlyUsageCount(deviceId: string, nowMs: number): number {
  const monthKey = monthKeyFor(nowMs);
  const row = db
    .prepare("SELECT count FROM device_monthly_usage WHERE device_id = ? AND month_key = ?")
    .get(deviceId, monthKey) as { count: number } | undefined;
  return row ? row.count : 0;
}
