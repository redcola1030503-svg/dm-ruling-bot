import express from "express";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { rulingJobsRouter } from "./routes/rulingJobs";
import { rulingThreadsRouter } from "./routes/rulingThreads";
import { pushRouter } from "./routes/push";
import { debugRouter } from "./routes/debug";
import { authRouter } from "./routes/auth";
import { judgesRouter } from "./routes/judges";
import { correctionsRouter } from "./routes/corrections";
import { cardsRouter } from "./routes/cards";
import { statsRouter } from "./routes/stats";
import { billingRouter } from "./routes/billing";
import { startOrphanedJobSweep } from "./ruling/orphanedJobSweep";
import { startHeartbeatRenewal } from "./ruling/rulingJob";
import { logger } from "./utils/logger";

const app = express();

// ngrok/Render/Railway等、リバースプロキシ配下での実行を想定し、直前の1ホップを信頼する
// (express-rate-limitがX-Forwarded-Forから正しいクライアントIPを識別するために必要)。
app.set("trust proxy", 1);

app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = Buffer.from(buf);
    },
  }),
);

app.use(healthRouter);
app.use(rulingJobsRouter);
app.use(rulingThreadsRouter);
app.use(pushRouter);
app.use(debugRouter);
app.use(authRouter);
app.use(judgesRouter);
app.use(correctionsRouter);
app.use(cardsRouter);
app.use(statsRouter);
app.use(billingRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("unhandled_error", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "internal_server_error" });
});

if (env.NODE_ENV === "production" && !env.REVENUECAT_WEBHOOK_SECRET) {
  logger.warn("revenuecat_webhook_secret_missing", {
    detail: "REVENUECAT_WEBHOOK_SECRET未設定のため、RevenueCat Webhookは全て401で拒否され続けます。",
  });
}
if (env.NODE_ENV === "production" && !env.REVENUECAT_API_KEY) {
  logger.warn("revenuecat_api_key_missing", {
    detail: "REVENUECAT_API_KEY未設定のため、/api/billing/syncは常に失敗します。",
  });
}

// T012(A): status IN ('pending','running')のまま長時間経過したジョブ
// (孤立ジョブ)を起動時+定期的に回収する。running判定はDBのheartbeat_atの
// 鮮度で行うため、デプロイによるプロセスの入れ替わりをまたいでも正しく動作する
// (T012 Review 8対応、詳細はsrc/ruling/orphanedJobSweep.ts参照)。
startOrphanedJobSweep();
// このプロセスが担当中のジョブのheartbeat_atを定期的に更新し、上記の孤立ジョブ
// 回収(このプロセス・他プロセス問わず)から生存中のジョブを除外できるようにする。
startHeartbeatRenewal();

app.listen(env.PORT, () => {
  logger.info("server_started", { port: env.PORT });
});
