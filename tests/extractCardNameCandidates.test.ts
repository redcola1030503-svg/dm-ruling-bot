import { describe, expect, it } from "vitest";
import { extractCardNameCandidates } from "../src/cards/extractCardNameCandidates";

describe("extractCardNameCandidates", () => {
  it("《》で囲まれたカード名を抽出する", () => {
    expect(extractCardNameCandidates("《ボルメテウス・ホワイト・ドラゴン》の効果は？")).toEqual([
      "ボルメテウス・ホワイト・ドラゴン",
    ]);
  });

  it("複数のカード名を重複なく抽出する", () => {
    const question = "相手の《カードA》が出ている状態で、自分が「カードB」を出しました。《カードA》は？";
    expect(extractCardNameCandidates(question)).toEqual(["カードA", "カードB"]);
  });

  it("該当なしの場合は空配列を返す", () => {
    expect(extractCardNameCandidates("S・トリガーとは何ですか？")).toEqual([]);
  });
});
