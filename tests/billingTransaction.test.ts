import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
const execMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: {
    prepare: (...args: unknown[]) => prepareMock(...args),
    exec: (...args: unknown[]) => execMock(...args),
  },
}));

const { createJobTransactionally } = await import("../src/billing/billingTransaction");

function stubStatement(sql: string) {
  const runFn = vi.fn();
  if (typeof sql === "string" && sql.includes("device_monthly_usage") && sql.includes("count = count")) {
    return { run: runFn, __kind: "increment" };
  }
  return { run: runFn, __kind: "createJob" };
}

describe("createJobTransactionally", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    execMock.mockReset();
    prepareMock.mockImplementation((sql: string) => stubStatement(sql));
  });

  it(
    "consumeFreeQuota=trueの場合、BEGIN→ジョブ作成→無料枠カウンタ加算→COMMITの" +
      "順で実行する(PR #1レビュー指摘P1対応: ジョブ作成とカウンタ加算の不整合防止)",
    () => {
      createJobTransactionally({
        jobId: "job-1",
        question: "質問",
        deviceId: "device-1",
        threadId: null,
        consumeFreeQuota: true,
        nowMs: Date.UTC(2026, 7, 15, 12, 0, 0),
      });

      const execCalls = execMock.mock.calls.map((c) => c[0]);
      expect(execCalls).toEqual(["BEGIN", "COMMIT"]);
      expect(
        prepareMock.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO ruling_job")),
      ).toBe(true);
      expect(
        prepareMock.mock.calls.some(
          ([sql]) => typeof sql === "string" && sql.includes("device_monthly_usage"),
        ),
      ).toBe(true);
    },
  );

  it("consumeFreeQuota=falseの場合、無料枠カウンタは加算せずCOMMITする(購読中は無料枠を消費しない)", () => {
    createJobTransactionally({
      jobId: "job-2",
      question: "質問",
      deviceId: "device-1",
      threadId: null,
      consumeFreeQuota: false,
      nowMs: Date.UTC(2026, 7, 15, 12, 0, 0),
    });

    const execCalls = execMock.mock.calls.map((c) => c[0]);
    expect(execCalls).toEqual(["BEGIN", "COMMIT"]);
    expect(
      prepareMock.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("device_monthly_usage")),
    ).toBe(false);
  });

  it("加算に失敗した場合はROLLBACKし、エラーを再送出する(ジョブだけが残る不整合を防ぐ)", () => {
    prepareMock.mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("device_monthly_usage")) {
        return {
          run: () => {
            throw new Error("db error");
          },
        };
      }
      return { run: vi.fn() };
    });

    expect(() =>
      createJobTransactionally({
        jobId: "job-3",
        question: "質問",
        deviceId: "device-1",
        threadId: null,
        consumeFreeQuota: true,
        nowMs: Date.UTC(2026, 7, 15, 12, 0, 0),
      }),
    ).toThrow("db error");

    const execCalls = execMock.mock.calls.map((c) => c[0]);
    expect(execCalls).toEqual(["BEGIN", "ROLLBACK"]);
  });
});
