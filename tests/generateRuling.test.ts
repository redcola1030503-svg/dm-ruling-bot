import { describe, expect, it } from "vitest";
import { applyCautionNote } from "../src/ruling/generateRuling";

describe("applyCautionNote", () => {
  it("highの場合は説明文をそのまま返す", () => {
    expect(applyCautionNote("結論の説明です。", "high")).toBe("結論の説明です。");
  });

  it("mediumの場合は推論を含む旨の注記を追加する", () => {
    const result = applyCautionNote("結論の説明です。", "medium");
    expect(result).toContain("結論の説明です。");
    expect(result).toContain("複数の情報を組み合わせた推論");
  });

  it("lowの場合は断定できない旨の注記を追加する", () => {
    const result = applyCautionNote("結論の説明です。", "low");
    expect(result).toContain("結論の説明です。");
    expect(result).toContain("断定はできません");
    expect(result).toContain("ジャッジにご確認ください");
  });
});
