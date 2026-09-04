import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getJob, getJobsByThread } from "../ruling/rulingJobRepository";
import { runRulingJobInBackground, canAcceptNewJob } from "../ruling/rulingJob";
import { createThread, getThread, touchThread, deriveThreadTitle } from "../ruling/rulingThreadRepository";
import { buildFollowUpQuestion } from "../ruling/threadContext";
import { logger } from "../utils/logger";
import { rulingRateLimiter } from "../utils/rateLimit";
import { getActiveUntil } from "../billing/deviceSubscriptionRepository";
import { evaluateRulingAccess } from "../billing/accessControl";
import { getMonthlyUsageCount } from "../billing/deviceMonthlyUsageRepository";
import { createJobTransactionally } from "../billing/billingTransaction";
import { createJobSchema } from "./rulingJobsSchema";

export const rulingJobsRouter = Router();

rulingJobsRouter.post("/api/ruling/jobs", rulingRateLimiter, (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  if (!canAcceptNewJob()) {
    res.status(503).json({ error: "busy", detail: "現在混雑しています。しばらくしてから再度お試しください。" });
    return;
  }

  const { question, deviceId, threadId: requestedThreadId } = parsed.data;

  const now = Date.now();
  const jobCountThisMonth = getMonthlyUsageCount(deviceId, now);
  const activeUntilMs = getActiveUntil(deviceId);
  const access = evaluateRulingAccess({ jobCountThisMonth, activeUntilMs, nowMs: now });
  if (!access.allowed) {
    res.status(402).json({ error: "subscription_required" });
    return;
  }

  // threadIdはユーザー(端末)を認証するものではなく自己申告の匿名IDのため、
  // device_idが一致しない(=他人のスレッドへの投稿、または存在しないスレッド)場合は
  // 存在有無を漏らさないよう一律404で扱う。
  let promptQuestion = question;
  let resolvedThreadId: string | null = null;

  if (requestedThreadId) {
    const thread = getThread(requestedThreadId);
    if (!thread || thread.device_id !== deviceId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    resolvedThreadId = thread.id;
    const priorJobs = getJobsByThread(thread.id);
    promptQuestion = buildFollowUpQuestion(priorJobs, question);
    touchThread(thread.id);
  } else {
    resolvedThreadId = randomUUID();
    createThread(resolvedThreadId, deviceId, deriveThreadTitle(question));
  }

  const jobId = randomUUID();
  // ジョブ作成と無料枠カウンタ加算は1トランザクションで行う(billing/billingTransaction.ts参照)。
  // 購読中(hasActiveSubscription)は無料枠を消費しない(D-001: 無料枠10問+購読中は使い放題)。
  createJobTransactionally({
    jobId,
    question,
    deviceId,
    threadId: resolvedThreadId,
    consumeFreeQuota: !access.hasActiveSubscription,
    nowMs: now,
  });
  logger.info("ruling_job_created", {
    jobId,
    questionLength: question.length,
    threadId: resolvedThreadId,
  });

  runRulingJobInBackground(jobId, promptQuestion, deviceId, resolvedThreadId);

  res.status(202).json({ jobId, status: "pending", threadId: resolvedThreadId });
});

rulingJobsRouter.get("/api/ruling/jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    outcomeStatus: job.outcome_status,
    result: job.result_json ? JSON.parse(job.result_json) : null,
    error: job.error,
    threadId: job.thread_id,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  });
});
