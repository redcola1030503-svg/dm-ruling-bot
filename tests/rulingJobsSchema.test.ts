import { describe, expect, it } from "vitest";
import { createJobSchema } from "../src/routes/rulingJobsSchema";

describe("createJobSchema", () => {
  it("deviceIdを省略するとバリデーションエラーになる(必須化により無料枠バイパスを防ぐ、PR #1レビュー指摘P0対応)", () => {
    const result = createJobSchema.safeParse({ question: "質問" });
    expect(result.success).toBe(false);
  });

  it("deviceIdを空文字にするとバリデーションエラーになる", () => {
    const result = createJobSchema.safeParse({ question: "質問", deviceId: "" });
    expect(result.success).toBe(false);
  });

  it("deviceIdを指定すれば検証を通過する", () => {
    const result = createJobSchema.safeParse({ question: "質問", deviceId: "device-1" });
    expect(result.success).toBe(true);
  });
});
