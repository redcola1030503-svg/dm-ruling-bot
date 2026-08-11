import { describe, expect, it, vi } from "vitest";
import type { GeneralRuleChunk } from "../src/rules/types";

const ensureGeneralRuleFresh = vi.fn<() => Promise<GeneralRuleChunk[]>>();
vi.mock("../src/rules/generalRuleSearch", () => ({
  ensureGeneralRuleFresh: () => ensureGeneralRuleFresh(),
}));

const { searchAndRankGeneralRules } = await import("../src/rules/generalRuleRanking");

describe("searchAndRankGeneralRules の処理順序系条文の別枠採用", () => {
  it("スコア上位に入らなくても処理順序系条文(101.4/409/603.2/603.3)は別枠で含める", async () => {
    const chunks: GeneralRuleChunk[] = [
      // S・トリガー関連の語を多く含み、通常スコアで上位に来る具体的な条文
      { ruleNumber: "112.3a", text: "S・トリガーはブレイクなどでシールドが手札に加えられるとき" },
      { ruleNumber: "509.5a", text: "S・トリガーは、シールドがブレイクされて手札に加わる時に宣言ができます" },
      { ruleNumber: "113.6", text: "ブレイクや効果によってシールドが手札に加えられる際、S・トリガーを宣言できます" },
      // 処理順序系だが、上のような具体的キーワードを含まないため通常スコアは低い
      { ruleNumber: "603.3", text: "能力が誘発したらターン・プレイヤーのものから順番に処理をします" },
      // 処理順序系だがスコア0(criteriaに一切一致しない)なので含まれないはず
      { ruleNumber: "409.2", text: "保留状態になったカードが別のゾーンへ移動しなかった場合の話" },
    ];
    ensureGeneralRuleFresh.mockResolvedValueOnce(chunks);

    const results = await searchAndRankGeneralRules(
      {
        cardNames: [],
        ruleConcepts: ["S・トリガー", "シールド", "ブレイク", "ターンプレイヤーの優先権"],
        keywords: [],
      },
      { topN: 2 },
    );

    const ruleNumbers = results.map((r) => r.ruleNumber);
    expect(ruleNumbers).toContain("603.3");
    expect(ruleNumbers).not.toContain("409.2");
  });

  it("該当する条文が何もない場合は空配列を返す", async () => {
    ensureGeneralRuleFresh.mockResolvedValueOnce([
      { ruleNumber: "100", text: "ゲームに必要なもの" },
    ]);

    const results = await searchAndRankGeneralRules({
      cardNames: [],
      ruleConcepts: ["無関係な概念"],
      keywords: [],
    });

    expect(results).toEqual([]);
  });
});
