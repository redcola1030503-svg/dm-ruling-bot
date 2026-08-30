import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { createJob, getJob, getJobsByThread, countJobsThisMonth } from "../ruling/rulingJobRepository";
import { runRulingJobInBackground, canAcceptNewJob } from "../ruling/rulingJob";
import { createThread, getThread, touchThread, deriveThreadTitle } from "../ruling/rulingThreadRepository";
import { buildFollowUpQuestion } from "../ruling/threadContext";
import { logger } from "../utils/logger";
import { rulingRateLimiter } from "../utils/rateLimit";
import { getActiveUntil } from "../billing/deviceSubscriptionRepository";
import { evaluateRulingAccess } from "../billing/accessControl";

export const rulingJobsRouter = Router();

const createJobSchema = z.object({
  question: z.string().min(1).max(1000),
  deviceId: z.string().min(1).max(200).optional(),
  threadId: z.string().min(1).max(200).optional(),
});

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

  const { question, deviceId: rawDeviceId, threadId: requestedThreadId } = parsed.data;
  const deviceId = rawDeviceId ?? null;

  // deviceId未送信(旧バージョン等)は既存仕様通り無料枠チェックの対象外とする。
  if (deviceId) {
    const now = Date.now();
    const jobCountThisMonth = countJobsThisMonth(deviceId, now);
    const activeUntilMs = getActiveUntil(deviceId);
    const { allowed } = evaluateRulingAccess({ jobCountThisMonth, activeUntilMs, nowMs: now });
    if (!allowed) {
      res.status(402).json({ error: "subscription_required" });
      return;
    }
  }

  // threadIdはユーザー(端末)を認証するものではなく自己申告の匿名IDのため、
  // device_idが一致しない(=他人のスレッドへの投稿、または存在しないスレッド)場合は
  // 存在有無を漏らさないよう一律404で扱う。
  let promptQuestion = question;
  let resolvedThreadId: string | null = null;

  if (requestedThreadId) {
    if (!deviceId) {
      res.status(400).json({ error: "invalid_request", detail: "threadIdを指定する場合はdeviceIdが必須です。" });
      return;
    }
    const thread = getThread(requestedThreadId);
    if (!thread || thread.device_id !== deviceId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    resolvedThreadId = thread.id;
    const priorJobs = getJobsByThread(thread.id);
    promptQuestion = buildFollowUpQuestion(priorJobs, question);
    touchThread(thread.id);
  } else if (deviceId) {
    resolvedThreadId = randomUUID();
    createThread(resolvedThreadId, deviceId, deriveThreadTitle(question));
  }

  const jobId = randomUUID();
  createJob(jobId, question, deviceId, resolvedThreadId);
  logger.info("ruling_job_created", {
    jobId,
    questionLength: question.length,
    hasDeviceId: !!deviceId,
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
