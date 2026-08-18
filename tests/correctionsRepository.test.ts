import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const {
  getCorrectionById,
  getCorrectionsByJudgeId,
  updateCorrectionRuling,
  deleteCorrection,
} = await import("../src/corrections/repository");

describe("corrections/repository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("getCorrectionsByJudgeId: 指定judgeIdの訂正のみをCorrection[]として返す", () => {
    const allFn = vi.fn().mockReturnValue([
      {
        id: 1,
        original_question: "Q1",
        bot_conclusion: "A1",
        correct_ruling: "C1",
        card_names: '["カードA"]',
        corrected_by: "U1",
        judge_id: "J001",
        created_at: 1000,
      },
    ]);
    prepareMock.mockReturnValue({ all: allFn });

    const corrections = getCorrectionsByJudgeId("J001");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("WHERE judge_id = ?"));
    expect(allFn).toHaveBeenCalledWith("J001");
    expect(corrections).toEqual([
      {
        id: 1,
        originalQuestion: "Q1",
        botConclusion: "A1",
        correctRuling: "C1",
        cardNames: ["カードA"],
        correctedBy: "U1",
        judgeId: "J001",
        createdAt: 1000,
      },
    ]);
  });

  it("getCorrectionById: 存在すればCorrectionを返す", () => {
    const getFn = vi.fn().mockReturnValue({
      id: 1,
      original_question: "Q1",
      bot_conclusion: "A1",
      correct_ruling: "C1",
      card_names: "[]",
      corrected_by: "U1",
      judge_id: "J001",
      created_at: 1000,
    });
    prepareMock.mockReturnValue({ get: getFn });

    expect(getCorrectionById(1)).toEqual({
      id: 1,
      originalQuestion: "Q1",
      botConclusion: "A1",
      correctRuling: "C1",
      cardNames: [],
      correctedBy: "U1",
      judgeId: "J001",
      createdAt: 1000,
    });
    expect(getFn).toHaveBeenCalledWith(1);
  });

  it("getCorrectionById: 存在しなければnull", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getCorrectionById(999)).toBeNull();
  });

  it("updateCorrectionRuling: 更新件数が1以上ならtrue", () => {
    const runFn = vi.fn().mockReturnValue({ changes: 1 });
    prepareMock.mockReturnValue({ run: runFn });

    expect(updateCorrectionRuling(1, "新しい裁定")).toBe(true);
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("UPDATE correction"));
    expect(runFn).toHaveBeenCalledWith("新しい裁定", 1);
  });

  it("updateCorrectionRuling: 更新件数が0ならfalse(未存在ID)", () => {
    prepareMock.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });
    expect(updateCorrectionRuling(999, "新しい裁定")).toBe(false);
  });

  it("deleteCorrection: 削除件数が1以上ならtrue", () => {
    prepareMock.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 1 }) });
    expect(deleteCorrection(1)).toBe(true);
  });

  it("deleteCorrection: 削除件数が0ならfalse(未存在ID)", () => {
    prepareMock.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });
    expect(deleteCorrection(999)).toBe(false);
  });
});
