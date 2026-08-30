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
