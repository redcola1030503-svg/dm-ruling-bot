import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { getJudge, getSession, addJudge, removeJudge, listJudges } = await import("../src/judges/repository");

describe("judges/repository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("getJudge: 存在すればJudgeを返す", () => {
    const getFn = vi.fn().mockReturnValue({
      id: "J001",
      role: "admin",
      created_at: 1000,
      created_by: "env:ADMIN_JUDGE_IDS",
    });
    prepareMock.mockReturnValue({ get: getFn });

    const judge = getJudge("J001");

    expect(judge).toEqual({ id: "J001", role: "admin", createdAt: 1000, createdBy: "env:ADMIN_JUDGE_IDS" });
    expect(getFn).toHaveBeenCalledWith("J001");
  });

  it("getJudge: 存在しなければnull", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getJudge("NOPE")).toBeNull();
  });

  it("getSession: judgeテーブルとのJOIN結果からroleを含むセッションを返す", () => {
    const getFn = vi.fn().mockReturnValue({
      user_id: "U1",
      judge_id: "J001",
      logged_in_at: 2000,
      role: "judge",
    });
    prepareMock.mockReturnValue({ get: getFn });

    const session = getSession("U1");

    expect(session).toEqual({ userId: "U1", judgeId: "J001", loggedInAt: 2000, role: "judge" });
  });

  it("getSession: セッションまたは対応するjudgeが無ければnull(=judge_removeで削除された場合も同様に扱われる)", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getSession("U1")).toBeNull();
  });

  it("addJudge: UPSERTでidとroleを保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    addJudge("J002", "judge", "J001");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO judge"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith("J002", "judge", expect.any(Number), "J001");
  });

  it("removeJudge: 削除件数が1以上ならtrue", () => {
    prepareMock.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 1 }) });
    expect(removeJudge("J002")).toBe(true);
  });

  it("removeJudge: 削除件数が0ならfalse(未登録IDの削除)", () => {
    prepareMock.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });
    expect(removeJudge("NOPE")).toBe(false);
  });

  it("listJudges: 登録済みジャッジ全件をJudge[]として返す", () => {
    const allFn = vi.fn().mockReturnValue([
      { id: "A001", role: "admin", created_at: 1000, created_by: "env:ADMIN_JUDGE_IDS" },
      { id: "J001", role: "judge", created_at: 2000, created_by: "A001" },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const judges = listJudges();

    expect(judges).toEqual([
      { id: "A001", role: "admin", createdAt: 1000, createdBy: "env:ADMIN_JUDGE_IDS" },
      { id: "J001", role: "judge", createdAt: 2000, createdBy: "A001" },
    ]);
  });
});
