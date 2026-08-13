import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { createJob, getJob } from "../ruling/rulingJobRepository";
import { runRulingJobInBackground, canAcceptNewJob } from "../ruling/rulingJob";
import { logger } from "../utils/logger";
import { rulingRateLimiter } from "../utils/rateLimit";

export const rulingJobsRouter = Router();

const createJobSchema = z.object({
  question: z.string().min(1).max(1000),
  deviceId: z.string().min(1).max(200).optional(),
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

  const jobId = randomUUID();
  const deviceId = parsed.data.deviceId ?? null;
  createJob(jobId, parsed.data.question, deviceId);
  logger.info("ruling_job_created", { jobId, questionLength: parsed.data.question.length, hasDeviceId: !!deviceId });

  runRulingJobInBackground(jobId, parsed.data.question, deviceId);

  res.status(202).json({ jobId, status: "pending" });
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
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  });
});
