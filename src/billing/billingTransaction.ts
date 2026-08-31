import { db } from "../config/db";
import { createJob } from "../ruling/rulingJobRepository";
import { incrementMonthlyUsage } from "./deviceMonthlyUsageRepository";

// ジョブ作成と無料枠カウンタ加算を1トランザクションにまとめる
// (PR #1レビュー指摘P1対応: 別々のDB操作だと、加算失敗時にジョブだけが
// 残って不整合になりうるため)。consumeFreeQuotaは購読中(hasActiveSubscription)
// かどうかで呼び出し側(rulingJobsルート)が決める。
export function createJobTransactionally(params: {
  jobId: string;
  question: string;
  deviceId: string;
  threadId: string | null;
  consumeFreeQuota: boolean;
  nowMs: number;
}): void {
  const { jobId, question, deviceId, threadId, consumeFreeQuota, nowMs } = params;
  db.exec("BEGIN");
  try {
    createJob(jobId, question, deviceId, threadId);
    if (consumeFreeQuota) {
      incrementMonthlyUsage(deviceId, nowMs);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
