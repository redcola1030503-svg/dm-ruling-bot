import express from "express";
import { env } from "./config/env";
import { healthRouter } from "./routes/health";
import { rulingRouter } from "./routes/ruling";
import { debugRouter } from "./routes/debug";
import { lineWebhookRouter } from "./routes/lineWebhook";
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
app.use(debugRouter);
app.use(lineWebhookRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("unhandled_error", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: "internal_server_error" });
});

app.listen(env.PORT, () => {
  logger.info("server_started", { port: env.PORT });
});
