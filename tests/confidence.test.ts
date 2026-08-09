import { describe, expect, it } from "vitest";
import { pickMoreCautious } from "../src/ruling/confidence";

describe("pickMoreCautious", () => {
  it("lowとhighならlowを返す", () => {
    expect(pickMoreCautious("low", "high")).toBe("low");
    expect(pickMoreCautious("high", "low")).toBe("low");
  });

  it("mediumとhighならmediumを返す", () => {
    expect(pickMoreCautious("medium", "high")).toBe("medium");
  });

  it("同じ値ならその値を返す", () => {
    expect(pickMoreCautious("high", "high")).toBe("high");
  });
});
