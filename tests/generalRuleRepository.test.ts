import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareMock = vi.fn();
vi.mock("../src/config/db", () => ({
  db: { prepare: (...args: unknown[]) => prepareMock(...args) },
}));

const { getGeneralRuleChunkByRuleNumber } = await import("../src/rules/generalRuleRepository");

describe("rules/generalRuleRepository", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  describe("getGeneralRuleChunkByRuleNumber", () => {
    it("該当する条文があればruleNumberとtextを返す", () => {
      const getFn = vi.fn().mockReturnValue({ rule_number: "509.2c", text: "条文の本文" });
      prepareMock.mockReturnValue({ get: getFn });

      const result = getGeneralRuleChunkByRuleNumber("509.2c");

      expect(result).toEqual({ ruleNumber: "509.2c", text: "条文の本文" });
      expect(getFn).toHaveBeenCalledWith("509.2c");
    });

    it("該当する条文がなければnullを返す", () => {
      prepareMock.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const result = getGeneralRuleChunkByRuleNumber("999.9z");

      expect(result).toBeNull();
    });
  });
});
