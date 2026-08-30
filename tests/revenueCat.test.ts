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
