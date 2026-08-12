import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JudgeSession } from "../src/judges/types";

const getSession = vi.fn<(userId: string) => JudgeSession | null>();
vi.mock("../src/judges/repository", () => ({
  getSession: (userId: string) => getSession(userId),
}));

const { requireAdminSession, requireJudgeSession } = await import("../src/judges/authMiddleware");

function makeReq(authorizationHeader: string | undefined) {
  return { header: vi.fn().mockReturnValue(authorizationHeader) } as unknown as Parameters<
    typeof requireJudgeSession
  >[0];
}

function makeRes() {
  const res: { locals: Record<string, unknown>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    locals: {},
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Parameters<typeof requireJudgeSession>[1] & typeof res;
}

describe("requireJudgeSession", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("Authorizationヘッダーが無ければ401", () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();

    requireJudgeSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "unauthorized" });
    expect(next).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("Bearerプレフィックスが無ければ401", () => {
    const req = makeReq("token-without-bearer-prefix");
    const res = makeRes();
    const next = vi.fn();

    requireJudgeSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("トークンが無効(getSessionがnull)なら401", () => {
    getSession.mockReturnValue(null);
    const req = makeReq("Bearer invalid-token");
    const res = makeRes();
    const next = vi.fn();

    requireJudgeSession(req, res, next);

    expect(getSession).toHaveBeenCalledWith("invalid-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("トークンが有効ならres.locals.judgeSessionを設定しnextを呼ぶ", () => {
    const session: JudgeSession = { userId: "tok123", judgeId: "J001", loggedInAt: 1000, role: "judge" };
    getSession.mockReturnValue(session);
    const req = makeReq("Bearer tok123");
    const res = makeRes();
    const next = vi.fn();

    requireJudgeSession(req, res, next);

    expect(res.locals.judgeSession).toEqual(session);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireAdminSession", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("judgeロールのセッションは403", () => {
    getSession.mockReturnValue({ userId: "tok", judgeId: "J001", loggedInAt: 1000, role: "judge" });
    const req = makeReq("Bearer tok");
    const res = makeRes();
    const next = vi.fn();

    requireAdminSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("adminロールのセッションはnextを呼ぶ", () => {
    getSession.mockReturnValue({ userId: "tok", judgeId: "A001", loggedInAt: 1000, role: "admin" });
    const req = makeReq("Bearer tok");
    const res = makeRes();
    const next = vi.fn();

    requireAdminSession(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("トークンが無効な場合は401(requireJudgeSessionの時点で弾く)", () => {
    getSession.mockReturnValue(null);
    const req = makeReq("Bearer bad");
    const res = makeRes();
    const next = vi.fn();

    requireAdminSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
