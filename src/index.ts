import express from "express";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { rulingRouter } from "./routes/ruling";
import { rulingJobsRouter } from "./routes/rulingJobs";
import { rulingThreadsRouter } from "./routes/rulingThreads";
import { pushRouter } from "./routes/push";
import { debugRouter } from "./routes/debug";
import { lineWebhookRouter } from "./routes/lineWebhook";
import { authRouter } from "./routes/auth";
import { judgesRouter } from "./routes/judges";
import { correctionsRouter } from "./routes/corrections";
import { cardsRouter } from "./routes/cards";
import { statsRouter } from "./routes/stats";
import { billingRouter } from "./routes/billing";
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
app.use(rulingRouter);
app.use(rulingJobsRouter);
app.use(rulingThreadsRouter);
app.use(pushRouter);
app.use(debugRouter);
app.use(lineWebhookRouter);
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

app.listen(env.PORT, () => {
  logger.info("server_started", { port: env.PORT });
});
