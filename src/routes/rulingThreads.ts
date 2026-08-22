import { Router } from "express";
import { z } from "zod";
import { deleteJobsByThread, getJobsByThread } from "../ruling/rulingJobRepository";
import { deleteThread, getThread, listThreadsByDevice } from "../ruling/rulingThreadRepository";

export const rulingThreadsRouter = Router();

const deviceIdQuerySchema = z.object({
  deviceId: z.string().min(1).max(200),
});

rulingThreadsRouter.get("/api/ruling/threads", (req, res) => {
  const parsed = deviceIdQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const threads = listThreadsByDevice(parsed.data.deviceId);
  res.json({
    threads: threads.map((thread) => {
      const jobs = getJobsByThread(thread.id);
      const latest = jobs.length > 0 ? jobs[jobs.length - 1] : null;
      return {
        threadId: thread.id,
        title: thread.title,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        jobCount: jobs.length,
        latestJob: latest
          ? {
              jobId: latest.id,
              status: latest.status,
              outcomeStatus: latest.outcome_status,
              conclusion: latest.result_json ? JSON.parse(latest.result_json).conclusion : null,
            }
          : null,
      };
    }),
  });
});

// deviceIdは認証情報ではなく自己申告の匿名IDのため、一致しないスレッドは
// 存在有無を漏らさないよう一律404で扱う(ログイン機能を新規実装しない方針上の既知の制約)。
rulingThreadsRouter.get("/api/ruling/threads/:threadId", (req, res) => {
  const parsed = deviceIdQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const thread = getThread(req.params.threadId);
  if (!thread || thread.device_id !== parsed.data.deviceId) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const jobs = getJobsByThread(thread.id);
  res.json({
    threadId: thread.id,
    title: thread.title,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    jobs: jobs.map((job) => ({
      jobId: job.id,
      question: job.question,
      status: job.status,
      outcomeStatus: job.outcome_status,
      result: job.result_json ? JSON.parse(job.result_json) : null,
      error: job.error,
      threadId: job.thread_id,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
    })),
  });
});

// deviceIdは認証情報ではなく自己申告の匿名IDのため、GETと同様に
// 一致しないスレッドは存在有無を漏らさないよう一律404で扱う。
rulingThreadsRouter.delete("/api/ruling/threads/:threadId", (req, res) => {
  const parsed = deviceIdQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const thread = getThread(req.params.threadId);
  if (!thread || thread.device_id !== parsed.data.deviceId) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  deleteJobsByThread(thread.id);
  deleteThread(thread.id);
  res.status(204).send();
});
