# サブスクリプション課金(バックエンド) Implementation Plan

> **Status: Historical implementation plan / Partially superseded(2026-09-02)**
> このプランの「無料枠は既存`ruling_job`テーブルの当月行数を集計する」というArchitectureは、
> モバイル側の「スレッド削除」機能で`ruling_job`行が物理削除されると無料枠が復活してしまう
> 不具合が最終レビューで発覚し却下された(`DECISIONS.md` D-003)。現行実装は独立カウンタ
> `device_monthly_usage`を使う。このファイルは当時の実装計画としての履歴目的でのみ保持し、
> 内容は書き換えていない。**現行実装の指示書としては使用しないこと**。最新の設計は
> `docs/superpowers/specs/2026-08-30-subscription-monetization-design.md`(Status: Current)を参照。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルアプリの質問投稿(`POST /api/ruling/jobs`)に月10問の無料枠を設け、超過分はRevenueCat経由のサブスクリプション(月額300円)が有効な場合のみ許可するバックエンドAPIを実装する。

**Architecture:** 既存の`ruling_job`テーブルを`device_id`+当月`created_at`で集計して無料枠消費を判定し、新規`device_subscription`テーブルに購読の有効期限(`active_until`)を保持する。購読状態の更新は常にRevenueCat(Webhook / REST API)を情報源とし、クライアントの自己申告は信用しない。

**Tech Stack:** Node.js/Express/TypeScript、SQLite(`node:sqlite`)、zod、vitest、axios(RevenueCat REST API呼び出し用、`package.json`に追加が必要)

**Spec:** `docs/superpowers/specs/2026-08-30-subscription-monetization-design.md`

## Global Constraints

- 無料枠は月10問(`RULING_FREE_MONTHLY_LIMIT`、環境変数で上書き可能、デフォルト10)
- 対象は`device_id`が送信されたリクエストのみ(deviceId無しの匿名リクエストは既存仕様通り無料枠チェックの対象外とする。既存コードで`deviceId`はoptionalであり、この挙動を変更しない)
- 購読状態の唯一の情報源はサーバー側DBの`device_subscription`テーブル。クライアントからの自己申告は一切信用しない
- 既存テストスイート(137件超)を壊さないこと。修正のたびに`npm test`と`npm run typecheck`を実行する
- 新規コードは既存の日本語コメント規約(「なぜ」を書く、自明なWhatは書かない)に従う

---

### Task 1: `device_subscription`テーブルとリポジトリ

**Files:**
- Modify: `src/config/db.ts`(テーブル追加。既存の`CREATE TABLE IF NOT EXISTS`群の末尾、`keyword_ability`の後に追加する)
- Create: `src/billing/deviceSubscriptionRepository.ts`
- Test: `tests/deviceSubscriptionRepository.test.ts`

**Interfaces:**
- Produces: `getActiveUntil(deviceId: string): number | null`、`setActiveUntil(deviceId: string, activeUntilMs: number): void`

- [ ] **Step 1: `src/config/db.ts`にテーブル定義を追加**

`db.exec`の既存のバッククォート文字列(`keyword_ability`テーブルの直後、197行目の```` `); ````の直前)に追加:

```sql
  CREATE TABLE IF NOT EXISTS device_subscription (
    device_id TEXT PRIMARY KEY,
    active_until INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/deviceSubscriptionRepository.test.ts`を新規作成:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { getActiveUntil, setActiveUntil } = await import("../src/billing/deviceSubscriptionRepository");

describe("deviceSubscriptionRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("getActiveUntil: レコードがあればactive_untilを返す", () => {
    const getFn = vi.fn().mockReturnValue({ active_until: 12345 });
    prepareMock.mockReturnValue({ get: getFn });

    const result = getActiveUntil("device-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("SELECT active_until"));
    expect(getFn).toHaveBeenCalledWith("device-1");
    expect(result).toBe(12345);
  });

  it("getActiveUntil: レコードが無ければnullを返す", () => {
    const getFn = vi.fn().mockReturnValue(undefined);
    prepareMock.mockReturnValue({ get: getFn });

    expect(getActiveUntil("device-unknown")).toBeNull();
  });

  it("setActiveUntil: UPSERTでactive_untilを設定する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    setActiveUntil("device-1", 99999);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT(device_id)"));
    expect(runFn).toHaveBeenCalledWith("device-1", 99999, expect.any(Number));
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test -- deviceSubscriptionRepository`
Expected: FAIL(`src/billing/deviceSubscriptionRepository`が存在しない)

- [ ] **Step 4: 最小実装を書く**

`src/billing/deviceSubscriptionRepository.ts`を新規作成(`src/push/pushTokenRepository.ts`と同じUPSERTパターンに揃える):

```typescript
import { db } from "../config/db";

export function getActiveUntil(deviceId: string): number | null {
  const row = db.prepare("SELECT active_until FROM device_subscription WHERE device_id = ?").get(deviceId) as
    | { active_until: number }
    | undefined;
  return row ? row.active_until : null;
}

export function setActiveUntil(deviceId: string, activeUntilMs: number): void {
  db.prepare(
    `INSERT INTO device_subscription (device_id, active_until, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET active_until = excluded.active_until, updated_at = excluded.updated_at`,
  ).run(deviceId, activeUntilMs, Date.now());
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test -- deviceSubscriptionRepository`
Expected: PASS(3件)

- [ ] **Step 6: コミット**

```bash
git add src/config/db.ts src/billing/deviceSubscriptionRepository.ts tests/deviceSubscriptionRepository.test.ts
git commit -m "サブスク購読状態を保持するdevice_subscriptionテーブルを追加"
```

---

### Task 2: 当月ジョブ件数カウント関数

**Files:**
- Modify: `src/ruling/rulingJobRepository.ts`
- Test: `tests/rulingJobRepository.test.ts`(既存ファイルに追記)

**Interfaces:**
- Consumes: なし
- Produces: `countJobsThisMonth(deviceId: string, nowMs: number): number`

- [ ] **Step 1: 失敗するテストを書く**

`tests/rulingJobRepository.test.ts`の末尾(既存の`describe`ブロック内、最後の`it`の後)に追記:

```typescript
  it("countJobsThisMonth: device_idと当月created_atで絞り込んでCOUNTする", () => {
    const getFn = vi.fn().mockReturnValue({ count: 3 });
    prepareMock.mockReturnValue({ get: getFn });

    // 2026-08-15 12:00:00 UTC を「現在時刻」とする
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    const result = countJobsThisMonth("device-1", now);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("COUNT(*) as count"));
    // 2026-08-01 00:00:00 UTC が月初(UNIXミリ秒)
    const monthStart = Date.UTC(2026, 7, 1, 0, 0, 0);
    expect(getFn).toHaveBeenCalledWith("device-1", monthStart);
    expect(result).toBe(3);
  });
```

ファイル冒頭のimport行を次のように変更(`countJobsThisMonth`を追加):

```typescript
const { createJob, getJobsByThread, deleteJobsByThread, pruneOldJobs, countJobsThisMonth } = await import(
  "../src/ruling/rulingJobRepository"
);
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- rulingJobRepository`
Expected: FAIL(`countJobsThisMonth is not a function`)

- [ ] **Step 3: 最小実装を書く**

`src/ruling/rulingJobRepository.ts`の末尾に追記:

```typescript
// 無料枠(月n問)の判定用。UTC暦月の月初からnowMsまでの件数を数える。
// JSTとの数時間のズレは無料枠判定の精度として許容する(意図的な簡略化)。
export function countJobsThisMonth(deviceId: string, nowMs: number): number {
  const now = new Date(nowMs);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0);
  const row = db
    .prepare("SELECT COUNT(*) as count FROM ruling_job WHERE device_id = ? AND created_at >= ?")
    .get(deviceId, monthStart) as { count: number };
  return row.count;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- rulingJobRepository`
Expected: PASS(既存4件 + 新規1件)

- [ ] **Step 5: コミット**

```bash
git add src/ruling/rulingJobRepository.ts tests/rulingJobRepository.test.ts
git commit -m "無料枠判定用に当月のruling_job件数を数える関数を追加"
```

---

### Task 3: アクセス可否判定ロジック(純粋関数)

**Files:**
- Create: `src/billing/accessControl.ts`
- Test: `tests/accessControl.test.ts`
- Modify: `src/config/env.ts`(`RULING_FREE_MONTHLY_LIMIT`を追加)
- Modify: `.env.example`

**Interfaces:**
- Consumes: なし(呼び出し元が`countJobsThisMonth`と`getActiveUntil`の結果を渡す)
- Produces: `evaluateRulingAccess(input: { jobCountThisMonth: number; activeUntilMs: number | null; nowMs: number }): { allowed: boolean; remainingFree: number }`

- [ ] **Step 1: `src/config/env.ts`に環境変数を追加**

`RULING_USE_BATCH_API`の定義の後に追記:

```typescript
  // 無料で利用できる月間の質問数。これを超えるとサブスクリプションが必須になる。
  RULING_FREE_MONTHLY_LIMIT: z.coerce.number().default(10),
```

`.env.example`の末尾に追記:

```
# 無料で利用できる月間の質問数(これを超えるとサブスクリプションが必須)
RULING_FREE_MONTHLY_LIMIT=10
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/accessControl.test.ts`を新規作成:

```typescript
import { describe, expect, it } from "vitest";
import { evaluateRulingAccess } from "../src/billing/accessControl";

const FREE_LIMIT = 10;
const now = Date.now();

describe("evaluateRulingAccess", () => {
  it("無料枠内(件数<上限)かつ未購読なら許可し、残り回数を返す", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 3, activeUntilMs: null, nowMs: now });
    expect(result).toEqual({ allowed: true, remainingFree: FREE_LIMIT - 3 });
  });

  it("無料枠ちょうど(件数=上限)かつ未購読なら不許可、残り回数は0", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 10, activeUntilMs: null, nowMs: now });
    expect(result).toEqual({ allowed: false, remainingFree: 0 });
  });

  it("無料枠超過でも購読が有効(active_untilが未来)なら許可", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 25, activeUntilMs: now + 1000, nowMs: now });
    expect(result.allowed).toBe(true);
  });

  it("無料枠超過かつ購読が失効済み(active_untilが過去)なら不許可", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 25, activeUntilMs: now - 1000, nowMs: now });
    expect(result.allowed).toBe(false);
  });

  it("無料枠内なら購読が失効済みでも許可(無料枠は購読の有無と独立)", () => {
    const result = evaluateRulingAccess({ jobCountThisMonth: 0, activeUntilMs: now - 1000, nowMs: now });
    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test -- accessControl`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 4: 最小実装を書く**

`src/billing/accessControl.ts`を新規作成:

```typescript
import { env } from "../config/env";

export type RulingAccessInput = {
  jobCountThisMonth: number;
  activeUntilMs: number | null;
  nowMs: number;
};

export type RulingAccessResult = {
  allowed: boolean;
  remainingFree: number;
};

export function evaluateRulingAccess(input: RulingAccessInput): RulingAccessResult {
  const { jobCountThisMonth, activeUntilMs, nowMs } = input;
  const remainingFree = Math.max(0, env.RULING_FREE_MONTHLY_LIMIT - jobCountThisMonth);
  const hasActiveSubscription = activeUntilMs !== null && activeUntilMs > nowMs;
  const withinFreeLimit = jobCountThisMonth < env.RULING_FREE_MONTHLY_LIMIT;

  return {
    allowed: withinFreeLimit || hasActiveSubscription,
    remainingFree,
  };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test -- accessControl`
Expected: PASS(5件)

- [ ] **Step 6: コミット**

```bash
git add src/billing/accessControl.ts tests/accessControl.test.ts src/config/env.ts .env.example
git commit -m "無料枠・サブスク購読状態からアクセス可否を判定する関数を追加"
```

---

### Task 4: RevenueCat連携共通処理

**Files:**
- Modify: `src/config/env.ts`(RevenueCat関連の環境変数を追加)
- Modify: `.env.example`
- Modify: `package.json`(`axios`は既存依存に含まれているため追加不要。確認のみ)
- Create: `src/billing/revenueCat.ts`
- Test: `tests/revenueCat.test.ts`

**Interfaces:**
- Consumes: `setActiveUntil`(Task 1)
- Produces: `verifyWebhookAuthorization(headerValue: string | undefined): boolean`、`applyEntitlement(appUserId: string, expiresAtMs: number | null): void`、`fetchCustomerEntitlementExpiry(appUserId: string): Promise<number | null>`

- [ ] **Step 1: 環境変数を追加**

`src/config/env.ts`に追記:

```typescript
  // RevenueCat WebhookのAuthorizationヘッダに設定する共有シークレット。
  // RevenueCatダッシュボード(Project > Integrations > Webhooks)で同じ値を設定する。
  // 未設定の場合、Webhookエンドポイントは全リクエストを401で拒否する(安全側デフォルト)。
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),

  // RevenueCatのREST API(GetCustomerInfo)呼び出し用のSecret API Key。
  REVENUECAT_API_KEY: z.string().optional(),

  // RevenueCatダッシュボードで設定した、月額サブスクリプションのエンタイトルメントID。
  REVENUECAT_ENTITLEMENT_ID: z.string().default("unlimited_questions"),
```

`.env.example`に追記:

```
# RevenueCat Webhookの共有シークレット(RevenueCatダッシュボードのWebhook設定と同じ値)
REVENUECAT_WEBHOOK_SECRET=
# RevenueCatのSecret API Key(REST API呼び出し用)
REVENUECAT_API_KEY=
# RevenueCatダッシュボードで設定したエンタイトルメントID
REVENUECAT_ENTITLEMENT_ID=unlimited_questions
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/revenueCat.test.ts`を新規作成:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env", () => ({
  env: {
    REVENUECAT_WEBHOOK_SECRET: "test-secret",
    REVENUECAT_API_KEY: "test-api-key",
    REVENUECAT_ENTITLEMENT_ID: "unlimited_questions",
  },
}));

const setActiveUntilMock = vi.fn();
vi.mock("../src/billing/deviceSubscriptionRepository", () => ({
  setActiveUntil: (...args: unknown[]) => setActiveUntilMock(...args),
}));

const axiosGetMock = vi.fn();
vi.mock("axios", () => ({
  default: { get: (...args: unknown[]) => axiosGetMock(...args) },
}));

const { verifyWebhookAuthorization, applyEntitlement, fetchCustomerEntitlementExpiry } = await import(
  "../src/billing/revenueCat"
);

describe("verifyWebhookAuthorization", () => {
  it("シークレットと一致すればtrue", () => {
    expect(verifyWebhookAuthorization("test-secret")).toBe(true);
  });

  it("シークレットと不一致ならfalse", () => {
    expect(verifyWebhookAuthorization("wrong-secret")).toBe(false);
  });

  it("ヘッダーが無ければfalse", () => {
    expect(verifyWebhookAuthorization(undefined)).toBe(false);
  });
});

describe("applyEntitlement", () => {
  it("expiresAtMsがあればsetActiveUntilを呼ぶ", () => {
    applyEntitlement("device-1", 12345);
    expect(setActiveUntilMock).toHaveBeenCalledWith("device-1", 12345);
  });

  it("expiresAtMsがnullなら過去日時(0)でsetActiveUntilを呼び即座に失効させる", () => {
    applyEntitlement("device-1", null);
    expect(setActiveUntilMock).toHaveBeenCalledWith("device-1", 0);
  });
});

describe("fetchCustomerEntitlementExpiry", () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
  });

  it("エンタイトルメントが有効ならexpires_dateをミリ秒で返す", async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        subscriber: {
          entitlements: {
            unlimited_questions: { expires_date: "2026-09-30T00:00:00Z" },
          },
        },
      },
    });

    const result = await fetchCustomerEntitlementExpiry("device-1");

    expect(axiosGetMock).toHaveBeenCalledWith(
      "https://api.revenuecat.com/v1/subscribers/device-1",
      { headers: { Authorization: "Bearer test-api-key" } },
    );
    expect(result).toBe(Date.parse("2026-09-30T00:00:00Z"));
  });

  it("該当エンタイトルメントが無ければnullを返す", async () => {
    axiosGetMock.mockResolvedValue({ data: { subscriber: { entitlements: {} } } });

    expect(await fetchCustomerEntitlementExpiry("device-1")).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test -- revenueCat`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 4: 最小実装を書く**

`src/billing/revenueCat.ts`を新規作成:

```typescript
import { timingSafeEqual } from "node:crypto";
import axios from "axios";
import { env } from "../config/env";
import { setActiveUntil } from "./deviceSubscriptionRepository";

// RevenueCatダッシュボードでWebhookに設定した「Authorization header value」と
// 一致するかを定数時間比較で検証する。長さが異なる場合はtimingSafeEqualが
// 例外を投げるため、先に長さを揃えてから比較する。
export function verifyWebhookAuthorization(headerValue: string | undefined): boolean {
  if (!env.REVENUECAT_WEBHOOK_SECRET || !headerValue) return false;
  const expected = Buffer.from(env.REVENUECAT_WEBHOOK_SECRET);
  const actual = Buffer.from(headerValue);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// expiresAtMsがnull(エンタイトルメント無し)の場合は0(1970年)を設定し、
// 以後のevaluateRulingAccessで確実に「未購読」として扱われるようにする。
export function applyEntitlement(appUserId: string, expiresAtMs: number | null): void {
  setActiveUntil(appUserId, expiresAtMs ?? 0);
}

// RevenueCatのREST API(GetCustomerInfo)。フィールド名は実装時点のドキュメント
// (https://www.revenuecat.com/docs/api-v1#tag/customers)に基づく。API仕様が
// 変わっている場合はこの関数のパース部分のみ修正すればよい。
export async function fetchCustomerEntitlementExpiry(appUserId: string): Promise<number | null> {
  const response = await axios.get(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${env.REVENUECAT_API_KEY}` } },
  );
  const entitlement = response.data?.subscriber?.entitlements?.[env.REVENUECAT_ENTITLEMENT_ID];
  if (!entitlement?.expires_date) return null;
  return Date.parse(entitlement.expires_date);
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test -- revenueCat`
Expected: PASS(7件)

- [ ] **Step 6: コミット**

```bash
git add src/billing/revenueCat.ts tests/revenueCat.test.ts src/config/env.ts .env.example
git commit -m "RevenueCat WebhookとREST APIの共通処理を追加"
```

---

### Task 5: Webhook・sync・usageエンドポイント

**Files:**
- Create: `src/routes/billing.ts`
- Modify: `src/index.ts`(ルーター登録)
- Modify: `src/utils/rateLimit.ts`(`billingRateLimiter`を追加)

**Interfaces:**
- Consumes: `verifyWebhookAuthorization`, `applyEntitlement`, `fetchCustomerEntitlementExpiry`(Task 4)、`getActiveUntil`(Task 1)、`countJobsThisMonth`(Task 2)、`evaluateRulingAccess`(Task 3)
- Produces: Express router `billingRouter`(`POST /api/billing/revenuecat-webhook`, `POST /api/billing/sync`, `GET /api/ruling/usage`)

このタスクはExpressルーティングの配線が中心で、ロジック自体はTask 1〜4で既にテスト済みのため、既存の`push.ts`等と同様にルート自体への専用テストは追加しない(このコードベースの既存ルートファイルにも専用テストは無い)。代わりにStep 4で`npm run typecheck`、Step 5で手動curl確認を行う。

- [ ] **Step 1: レート制限を追加**

`src/utils/rateLimit.ts`に追記:

```typescript
// 課金関連(Webhook・購入直後の同期)。RevenueCatからのWebhookとアプリからの
// 同期呼び出しのみが対象で、通常利用では低頻度なため他のAPIより緩めに制限する。
export const billingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});
```

- [ ] **Step 2: `src/routes/billing.ts`を新規作成**

```typescript
import { Router } from "express";
import { z } from "zod";
import { verifyWebhookAuthorization, applyEntitlement, fetchCustomerEntitlementExpiry } from "../billing/revenueCat";
import { getActiveUntil } from "../billing/deviceSubscriptionRepository";
import { countJobsThisMonth } from "../ruling/rulingJobRepository";
import { evaluateRulingAccess } from "../billing/accessControl";
import { billingRateLimiter } from "../utils/rateLimit";
import { logger } from "../utils/logger";

export const billingRouter = Router();

const webhookEventSchema = z.object({
  event: z.object({
    type: z.string(),
    app_user_id: z.string(),
    expiration_at_ms: z.number().nullable().optional(),
  }),
});

billingRouter.post("/api/billing/revenuecat-webhook", billingRateLimiter, (req, res) => {
  if (!verifyWebhookAuthorization(req.header("authorization"))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = webhookEventSchema.safeParse(req.body);
  if (!parsed.success) {
    // RevenueCatに再送されても困る不正ペイロードのため200で受理しログのみ残す。
    logger.warn("revenuecat_webhook_invalid_payload", { details: parsed.error.flatten() });
    res.status(200).json({ status: "ignored" });
    return;
  }

  const { app_user_id: appUserId, expiration_at_ms: expiresAtMs, type } = parsed.data.event;
  applyEntitlement(appUserId, expiresAtMs ?? null);
  logger.info("revenuecat_webhook_applied", { appUserId, type, expiresAtMs });
  res.status(200).json({ status: "ok" });
});

const syncSchema = z.object({
  deviceId: z.string().min(1).max(200),
});

billingRouter.post("/api/billing/sync", billingRateLimiter, async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  try {
    const expiresAtMs = await fetchCustomerEntitlementExpiry(parsed.data.deviceId);
    applyEntitlement(parsed.data.deviceId, expiresAtMs);
    res.status(204).send();
  } catch (error) {
    logger.error("revenuecat_sync_failed", {
      deviceId: parsed.data.deviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: "sync_failed" });
  }
});

const usageQuerySchema = z.object({
  deviceId: z.string().min(1).max(200),
});

billingRouter.get("/api/ruling/usage", (req, res) => {
  const parsed = usageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
    return;
  }

  const now = Date.now();
  const jobCountThisMonth = countJobsThisMonth(parsed.data.deviceId, now);
  const activeUntilMs = getActiveUntil(parsed.data.deviceId);
  const { allowed, remainingFree } = evaluateRulingAccess({ jobCountThisMonth, activeUntilMs, nowMs: now });

  res.json({
    remainingFree,
    subscriptionActive: activeUntilMs !== null && activeUntilMs > now,
    canAskQuestion: allowed,
  });
});
```

- [ ] **Step 3: `src/index.ts`にルーターを登録**

`import { statsRouter } from "./routes/stats";`の下に追記:

```typescript
import { billingRouter } from "./routes/billing";
```

`app.use(statsRouter);`の下に追記:

```typescript
app.use(billingRouter);
```

- [ ] **Step 4: 型チェック・既存テストを確認**

Run: `npm run typecheck && npm test`
Expected: どちらもエラーなく完了

- [ ] **Step 5: ローカルで手動確認**

`npm run dev`でサーバーを起動し、別ターミナルで以下を実行:

```bash
# Webhookシークレット不一致 → 401になること
curl -i -X POST http://localhost:3000/api/billing/revenuecat-webhook \
  -H "Authorization: wrong-secret" -H "Content-Type: application/json" \
  -d '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"test-device","expiration_at_ms":9999999999999}}'
# → HTTP/1.1 401

# .envのREVENUECAT_WEBHOOK_SECRETと一致する値を使う → 200になること
curl -i -X POST http://localhost:3000/api/billing/revenuecat-webhook \
  -H "Authorization: <.envに設定した値>" -H "Content-Type: application/json" \
  -d '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"test-device","expiration_at_ms":9999999999999}}'
# → HTTP/1.1 200

# 利用状況を確認 → subscriptionActive: true になっていること
curl -s "http://localhost:3000/api/ruling/usage?deviceId=test-device"
```

- [ ] **Step 6: コミット**

```bash
git add src/routes/billing.ts src/index.ts src/utils/rateLimit.ts
git commit -m "RevenueCat Webhook・sync・利用状況取得エンドポイントを追加"
```

---

### Task 6: `/api/ruling/jobs`への無料枠ゲート追加

**Files:**
- Modify: `src/routes/rulingJobs.ts`

**Interfaces:**
- Consumes: `countJobsThisMonth`(Task 2)、`getActiveUntil`(Task 1)、`evaluateRulingAccess`(Task 3)

- [ ] **Step 1: import文を追加**

`src/routes/rulingJobs.ts`冒頭のimportに追記:

```typescript
import { getActiveUntil } from "../billing/deviceSubscriptionRepository";
import { countJobsThisMonth } from "./rulingJobRepository"; // 既存importの並びに合わせて修正(下記Step2参照)
import { evaluateRulingAccess } from "../billing/accessControl";
```

(`countJobsThisMonth`は既存の`import { createJob, getJob, getJobsByThread } from "../ruling/rulingJobRepository";`に含めて1行にまとめる)

- [ ] **Step 2: ハンドラーに無料枠チェックを追加**

`if (!canAcceptNewJob()) { ... }`ブロックの直後、`const { question, deviceId: rawDeviceId, ... }`の前に追加:

```typescript
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
```

(この位置は既存の`const { question, deviceId: rawDeviceId, threadId: requestedThreadId } = parsed.data;`という行を上書きするのではなく、その直後に挿入する形。重複しないよう既存行はそのまま残す)

- [ ] **Step 3: 型チェック・既存テストを確認**

Run: `npm run typecheck && npm test`
Expected: どちらもエラーなく完了(このルートには既存の専用テストが無いため新規失敗は発生しない)

- [ ] **Step 4: 手動確認**

`npm run dev`を起動し、無料枠を使い切ったdeviceIdで11回目のリクエストを送ると402が返ることを確認:

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/ruling/jobs \
    -H "Content-Type: application/json" \
    -d '{"question":"テスト質問","deviceId":"quota-test-device"}'
done
# 1〜10回目: 202、11回目: 402 になること
```

- [ ] **Step 5: コミット**

```bash
git add src/routes/rulingJobs.ts
git commit -m "無料枠超過時にサブスク未購読ならquestionsを402で拒否するよう変更"
```

---

## 完了後の確認事項(コード外)

- Render本番環境の環境変数に`REVENUECAT_WEBHOOK_SECRET`・`REVENUECAT_API_KEY`・`REVENUECAT_ENTITLEMENT_ID`を設定する
- RevenueCatダッシュボードでWebhook送信先URLを`https://dm-ruling-bot.onrender.com/api/billing/revenuecat-webhook`に設定し、Authorizationヘッダの値を上記シークレットと一致させる
