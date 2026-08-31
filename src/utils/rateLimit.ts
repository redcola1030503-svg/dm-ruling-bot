import rateLimit from "express-rate-limit";

// LLM/公式サイトアクセスを伴う裁定APIは、1分あたりの呼び出し回数を厳しめに制限する。
export const rulingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", detail: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
});

// LINE Webhookはプラットフォーム側からの再送もあるため、やや緩めに制限する。
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

// ログインはジャッジIDを知っているだけで成立し(パスワード無し)、公開APIとして
// 晒すと総当たりでジャッジIDを探索されるリスクがあるため、他のAPIより厳しく制限する。
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

// プッシュ通知トークン登録は端末起動・トークンrefreshのたびに呼ばれる程度の
// 低頻度アクセスなので、乱用防止の範囲で緩めに制限する。
export const pushRegisterRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

// 利用統計・条文全文・訂正事例全文など、DB読み取りのみで軽量な公開APIの
// 乱用防止用。LLM呼び出しを伴わないため他のAPIより緩めに制限する。
export const publicReadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

// 課金関連(Webhook・購入直後の同期)。RevenueCatからのWebhookとアプリからの
// 同期呼び出しのみが対象で、通常利用では低頻度なため他のAPIより緩めに制限する。
export const billingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});
