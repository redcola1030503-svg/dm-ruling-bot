import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { incrementMonthlyUsage, getMonthlyUsageCount } = await import(
  "../src/billing/deviceMonthlyUsageRepository"
);

describe("deviceMonthlyUsageRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("incrementMonthlyUsage: UPSERTでcountをインクリメントする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    // 2026-08-15 12:00:00 UTC
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    incrementMonthlyUsage("device-1", now);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT(device_id, month_key)"));
    expect(runFn).toHaveBeenCalledWith("device-1", "2026-08");
  });

  it("getMonthlyUsageCount: device_idと月キーで絞り込んでcountを返す", () => {
    const getFn = vi.fn().mockReturnValue({ count: 5 });
    prepareMock.mockReturnValue({ get: getFn });

    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    const result = getMonthlyUsageCount("device-1", now);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("SELECT count"));
    expect(getFn).toHaveBeenCalledWith("device-1", "2026-08");
    expect(result).toBe(5);
  });

  it("getMonthlyUsageCount: レコードが無ければ0を返す", () => {
    const getFn = vi.fn().mockReturnValue(undefined);
    prepareMock.mockReturnValue({ get: getFn });

    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    expect(getMonthlyUsageCount("device-unknown", now)).toBe(0);
  });
});
