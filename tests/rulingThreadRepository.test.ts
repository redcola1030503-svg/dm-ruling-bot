import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const {
  createThread,
  getThread,
  touchThread,
  listThreadsByDevice,
  deriveThreadTitle,
  deleteThread,
} = await import("../src/ruling/rulingThreadRepository");

describe("rulingThreadRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("createThread: id/deviceId/titleでINSERTする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    createThread("thread-1", "device-1", "タイトル");

    expect(runFn).toHaveBeenCalledWith(
      "thread-1",
      "device-1",
      "タイトル",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("getThread: 見つからなければnullを返す", () => {
    const getFn = vi.fn().mockReturnValue(undefined);
    prepareMock.mockReturnValue({ get: getFn });

    expect(getThread("thread-x")).toBeNull();
  });

  it("touchThread: updated_atを更新する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    touchThread("thread-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("UPDATE ruling_thread SET updated_at"));
    expect(runFn).toHaveBeenCalledWith(expect.any(Number), "thread-1");
  });

  it("listThreadsByDevice: device_idでupdated_at降順に取得する", () => {
    const allFn = vi.fn().mockReturnValue([]);
    prepareMock.mockReturnValue({ all: allFn });

    listThreadsByDevice("device-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ORDER BY updated_at DESC"));
    expect(allFn).toHaveBeenCalledWith("device-1", 100);
  });

  it("deleteThread: idでDELETEする", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    deleteThread("thread-1");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM ruling_thread"));
    expect(runFn).toHaveBeenCalledWith("thread-1");
  });

  describe("deriveThreadTitle", () => {
    it("40文字以内ならそのまま返す", () => {
      expect(deriveThreadTitle("短い質問")).toBe("短い質問");
    });

    it("40文字を超えると省略して末尾に…を付ける", () => {
      const longQuestion = "あ".repeat(50);
      const title = deriveThreadTitle(longQuestion);

      expect(title).toBe(`${"あ".repeat(40)}…`);
    });
  });
});
