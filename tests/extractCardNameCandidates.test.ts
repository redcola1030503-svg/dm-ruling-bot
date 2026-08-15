import { describe, expect, it } from "vitest";
import {
  extractCardNameCandidates,
  extractCardNameCandidatesTiered,
} from "../src/cards/extractCardNameCandidates";

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

describe("extractCardNameCandidatesTiered", () => {
  it("《》由来をstrong、「」『』由来をweakに分ける", () => {
    const question = "自分の「侵略」を使い、《カードA》の能力を『発動』しました。";
    expect(extractCardNameCandidatesTiered(question)).toEqual({
      strong: ["カードA"],
      weak: ["侵略", "発動"],
    });
  });

  it("同じ文字列が《》と「」の両方に出てきたらstrong扱いのみにする", () => {
    const question = "《正義星帝》の能力にある「正義星帝」とは？";
    expect(extractCardNameCandidatesTiered(question)).toEqual({
      strong: ["正義星帝"],
      weak: [],
    });
  });

  it("該当なしの場合は両方空配列を返す", () => {
    expect(extractCardNameCandidatesTiered("S・トリガーとは何ですか？")).toEqual({
      strong: [],
      weak: [],
    });
  });
});
