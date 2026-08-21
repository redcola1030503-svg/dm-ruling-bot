import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { upsertKeywordAbility, getKeywordAbilityUpdatedAt, getKeywordAbilityCount, getKeywordAbilitiesByNames } =
  await import("../src/rules/keywordAbilityRepository");

describe("rules/keywordAbilityRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("upsertKeywordAbility: INSERT ... ON CONFLICTで保存する", () => {
    const runFn = vi.fn();
    prepareMock.mockReturnValue({ run: runFn });

    upsertKeywordAbility("侵略", "https://dmwiki.net/侵略", "説明文");

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO keyword_ability"));
    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"));
    expect(runFn).toHaveBeenCalledWith("侵略", "https://dmwiki.net/侵略", "説明文", expect.any(Number));
  });

  it("getKeywordAbilityUpdatedAt: 存在すればupdated_atを返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ updated_at: 12345 }) });
    expect(getKeywordAbilityUpdatedAt("侵略")).toBe(12345);
  });

  it("getKeywordAbilityUpdatedAt: 存在しなければnull", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    expect(getKeywordAbilityUpdatedAt("nope")).toBeNull();
  });

  it("getKeywordAbilityCount: 件数を返す", () => {
    prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue({ count: 392 }) });
    expect(getKeywordAbilityCount()).toBe(392);
  });

  it("getKeywordAbilitiesByNames: 名前が空配列ならDBに問い合わせず空配列を返す", () => {
    expect(getKeywordAbilitiesByNames([])).toEqual([]);
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it("getKeywordAbilitiesByNames: IN句で一致する行を返す", () => {
    const allFn = vi.fn().mockReturnValue([{ name: "侵略", url: "https://dmwiki.net/侵略", description: "説明" }]);
    prepareMock.mockReturnValue({ all: allFn });

    const result = getKeywordAbilitiesByNames(["侵略", "革命チェンジ"]);

    expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining("IN (?, ?)"));
    expect(allFn).toHaveBeenCalledWith("侵略", "革命チェンジ");
    expect(result).toEqual([{ name: "侵略", url: "https://dmwiki.net/侵略", description: "説明" }]);
  });
});
