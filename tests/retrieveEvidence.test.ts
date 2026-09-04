import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardInfo } from "../src/cards/types";
import type { CardNameMatch } from "../src/cards/cardNameMatcher";
import { extractRuleConcepts } from "../src/rules/ruleConceptDictionary";

vi.mock("../src/rules/ruleChangeRanking", () => ({
  searchAndRankRuleChanges: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/search/hybridSearch", () => ({
  hybridSearchGeneralRules: vi.fn().mockResolvedValue([]),
  hybridSearchQa: vi.fn().mockResolvedValue([]),
}));
const searchAndRankCorrections = vi.fn().mockReturnValue([]);
vi.mock("../src/corrections/ranking", () => ({ searchAndRankCorrections: (...args: unknown[]) => searchAndRankCorrections(...args) }));
const getKeywordAbilitiesByNames = vi.fn().mockReturnValue([]);
vi.mock("../src/rules/keywordAbilityRepository", () => ({
  getKeywordAbilitiesByNames: (names: string[]) => getKeywordAbilitiesByNames(names),
}));

const findCardCandidates = vi.fn<(name: string) => Promise<CardNameMatch[]>>();
vi.mock("../src/cards/cardNameMatcher", () => ({
  findCardCandidates: (name: string) => findCardCandidates(name),
}));

const { retrieveEvidence } = await import("../src/ruling/retrieveEvidence");

// findCardCandidatesはmockResolvedValueOnceの積み上げキューで各テストの返り値を
// 用意しているが、cardNamesが空の質問(この呼び出し自体が発生しない)テストでも
// 律儀にmockResolvedValueOnceを積んでいるものがあり、リセットが無いと後続の
// テスト(cardNamesが非空)がその「使われなかった前のテストの分」を誤って
// 消費してしまう(2026-09-04、新規テスト追加時に発覚した既存の分離不備)。
// 各テスト開始時にリセットし、キューの持ち越しを防ぐ。
beforeEach(() => {
  findCardCandidates.mockReset();
});

function makeCard(overrides: Partial<CardInfo>): CardInfo {
  const base = {
    id: "id",
    url: "https://example.com",
    name: "カード",
    alternateNames: [] as string[],
    cardType: "クリーチャー",
    civilization: "水",
    rarity: "C",
    power: "1000",
    cost: "1",
    mana: "1",
    race: "",
    cardText: "",
    flavorText: "",
    illustrator: "",
    qaListUrl: null,
    ...overrides,
  };
  return {
    ...base,
    // facesを明示的に上書きしていない限り、主要面(name等)から1件だけ生成する。
    faces: overrides.faces ?? [
      {
        name: base.name,
        cardType: base.cardType,
        civilization: base.civilization,
        rarity: base.rarity,
        power: base.power,
        cost: base.cost,
        mana: base.mana,
        race: base.race,
      },
    ],
  };
}

/** CardNameMatchを組み立てる。matchedFaceは明示しない限りcard.faces[0]を使う。 */
function makeMatch(
  card: CardInfo,
  matchType: CardNameMatch["matchType"],
  score: number,
  matchedFace = card.faces[0]!,
): CardNameMatch {
  return { card, matchedFace, matchType, score };
}

function makeParsedQuestion(cardNames: string[], weakCardNames: string[] = [], ruleConcepts: string[] = []) {
  return {
    originalText: cardNames.join(" "),
    cardNames,
    weakCardNames,
    keywords: [],
    ruleConcepts,
    situation: "",
    question: "",
  };
}

describe("retrieveEvidence のカード名あいまい判定", () => {
  it("exact一致のみの場合は確定してcardsに含める", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "a", name: "斬隠蒼頭龍バイケン" }), "exact", 1),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["斬隠蒼頭龍バイケン"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
    expect(evidence.cards[0].title).toBe("斬隠蒼頭龍バイケン");
  });

  it("prefix一致で他に閾値超えの候補がなければ確定する", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "a", name: "勝熱英雄 モモキング" }), "prefix", 0.9),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["勝熱英雄"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
  });

  it("prefix一致でも他に閾値超えの別カードが並ぶ場合はあいまい判定にする", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "a", name: "ベートーベン・キューブ" }), "prefix", 0.9),
      makeMatch(makeCard({ id: "b", name: "「修羅」の頂 VAN・ベートーベン" }), "partial", 0.75),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["ベートーベン"]));

    expect(evidence.cards).toHaveLength(0);
    expect(evidence.ambiguousCards).toEqual([
      {
        queried: "ベートーベン",
        candidates: ["ベートーベン・キューブ", "「修羅」の頂 VAN・ベートーベン"],
      },
    ]);
  });

  it("候補が0件の場合はambiguousCardsに追加しない(裁定生成側に委ねる)", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["存在しないカード"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(0);
  });

  it("フルネームでexact一致していれば、同じカードの略称側もあいまい判定にしない", async () => {
    const fullNameMatch: CardNameMatch = makeMatch(
      makeCard({ id: "baiken", name: "斬隠蒼頭龍バイケン" }),
      "exact",
      1,
    );
    const abbreviatedMatches: CardNameMatch[] = [
      makeMatch(makeCard({ id: "other", name: "バイケンの海幻" }), "prefix", 0.9),
      makeMatch(makeCard({ id: "baiken", name: "斬隠蒼頭龍バイケン" }), "partial", 0.75),
    ];
    findCardCandidates.mockResolvedValueOnce([fullNameMatch]);
    findCardCandidates.mockResolvedValueOnce(abbreviatedMatches);

    const evidence = await retrieveEvidence(makeParsedQuestion(["斬隠蒼頭龍バイケン", "バイケン"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
    expect(evidence.cards[0].title).toBe("斬隠蒼頭龍バイケン");
  });
});

describe("retrieveEvidence の弱いカード名候補(「」『』由来)の扱い", () => {
  it("見つからなくてもambiguousCardsに追加しない(一般名詞の誤爆対策)", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], ["侵略"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(0);
  });

  it("十分なスコアで見つかった場合はcardsに採用する", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "a", name: "「正義星帝」＜ライオネル.Star＞" }), "exact", 1),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], ["正義星帝"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(1);
    expect(evidence.cards[0].title).toBe("「正義星帝」＜ライオネル.Star＞");
  });

  it("低スコアの候補しかない場合は採用もambiguous化もしない", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "a", name: "何か別のカード" }), "fuzzy", 0.3),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], ["猫"]));

    expect(evidence.ambiguousCards).toHaveLength(0);
    expect(evidence.cards).toHaveLength(0);
  });
});

describe("retrieveEvidence のkeywordAbility説明文の切り詰め", () => {
  it("短い説明文はそのまま渡す", async () => {
    findCardCandidates.mockResolvedValueOnce([]);
    getKeywordAbilitiesByNames.mockReturnValueOnce([
      { name: "侵略", url: "https://dmwiki.net/侵略", description: "短い説明文" },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion([]));

    expect(evidence.keywordAbilities).toHaveLength(1);
    expect(evidence.keywordAbilities[0].text).toBe("短い説明文");
  });

  it("長い説明文は改行境界で切り詰めて省略注記を付ける", async () => {
    findCardCandidates.mockResolvedValueOnce([]);
    const paragraph = "あ".repeat(100);
    const longDescription = Array.from({ length: 20 }, () => paragraph).join("\n"); // 2000文字超
    getKeywordAbilitiesByNames.mockReturnValueOnce([
      { name: "侵略", url: "https://dmwiki.net/侵略", description: longDescription },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion([]));

    const text = evidence.keywordAbilities[0].text;
    expect(text.length).toBeLessThan(longDescription.length);
    expect(text.endsWith("…(以下省略。詳細は元ページのURLを参照)")).toBe(true);
    expect(text.startsWith(paragraph)).toBe(true);
  });
});

describe("retrieveEvidence の検証済み裁定原則(D-006)の検索", () => {
  it("正例: 「置換効果」を含む質問には置換効果の決定順の原則が注入される", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["置換効果"]));

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).toContain(
      "replacement-effect-order-multiple-events",
    );
  });

  it("正例: 「W・ブレイカー」を含む質問には複数ブレイカー宣言の原則が注入される", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["W・ブレイカー"]));

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).toContain(
      "multiple-breaker-abilities-must-declare",
    );
  });

  it("正例: 「参加できな」(語幹)を含む質問には攻撃/ブロック指定持続の原則が注入される", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["参加できな"]));

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).toContain(
      "attack-block-designation-persists",
    );
  });

  it("正例: 実際の質問解析経路(extractRuleConcepts)を通した「攻撃できなくなる」等の言い回しでも注入される", async () => {
    const question1 = "このクリーチャーは攻撃できなくなりますか？";
    const evidence1 = await retrieveEvidence(
      makeParsedQuestion([], [], extractRuleConcepts(question1)),
    );
    expect(evidence1.verifiedRulingPrinciples.map((p) => p.itemKey)).toContain(
      "attack-block-designation-persists",
    );

    const question2 = "ブロックできなかった場合の処理を教えてください";
    const evidence2 = await retrieveEvidence(
      makeParsedQuestion([], [], extractRuleConcepts(question2)),
    );
    expect(evidence2.verifiedRulingPrinciples.map((p) => p.itemKey)).toContain(
      "attack-block-designation-persists",
    );
  });

  it("負例: 無関係な質問には検証済み裁定原則が注入されない", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["進化"]));

    expect(evidence.verifiedRulingPrinciples).toHaveLength(0);
  });

  it("既知の限界(P1): 置換効果の1イベント内多重適用可否を聞く質問(ルール16対象)にも、" +
    "doesNotApplyWhenの条件に反して原則17が過剰に取得される。textにdoesNotApplyWhenが" +
    "含まれることで、最終判断はLLMに委ねられる設計になっている", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["置換効果"]));

    const principle = evidence.verifiedRulingPrinciples.find(
      (p) => p.itemKey === "replacement-effect-order-multiple-events",
    );
    expect(principle).toBeDefined();
    expect(principle?.text).toContain("適用しない条件");
    expect(principle?.text).toContain("101.5");
  });

  it("攻撃・ブロック指定持続の原則は「攻撃クリーチャー自体が取り除かれた」場合をdoesNotApplyWhenに含める(適用条件との矛盾防止)", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["参加できな"]));

    const principle = evidence.verifiedRulingPrinciples.find(
      (p) => p.itemKey === "attack-block-designation-persists",
    );
    expect(principle).toBeDefined();
    expect(principle?.text).toContain("取り除かれた場合");
  });

  it("正例(2026-09-04追加): 質問文に「無視する」等の一般語が無くても、カード名の一致で「能力を無視する」原則が注入される", async () => {
    // モルトDREAM×エモーショナル・ハードコアの相互作用を1ターン目の質問(「選択した時」
    // としか書いておらず「無視する」とは書いていない)から拾えるようにする回帰テスト。
    findCardCandidates
      .mockResolvedValueOnce([
        makeMatch(makeCard({ id: "a", name: "夢双龍覇 モルトDREAM" }), "exact", 1),
      ])
      .mockResolvedValueOnce([
        makeMatch(makeCard({ id: "b", name: "神聖龍 エモーショナル・ハードコア" }), "exact", 1),
      ]);

    // ruleConceptsは空のまま(実際の質問文には「無視する」という語が無いケースを再現)。
    const evidence = await retrieveEvidence(
      makeParsedQuestion(["夢双龍覇 モルトDREAM", "神聖龍 エモーショナル・ハードコア"], [], []),
    );

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).toContain(
      "ignore-ability-does-not-cancel-already-waiting-triggered-ability",
    );
  });

  it("負例(2026-09-04追加): 2枚のうち片方のカード名しか一致しない場合は「能力を無視する」原則は注入されない(AND条件、OR条件ではない)", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "a", name: "夢双龍覇 モルトDREAM" }), "exact", 1),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["夢双龍覇 モルトDREAM"], [], []));

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).not.toContain(
      "ignore-ability-does-not-cancel-already-waiting-triggered-ability",
    );
  });

  it("負例(2026-09-04追加、Codexレビュー指摘): 「無視する」という語だけでは、カードの組み合わせと無関係な質問には注入されない(汎用語による過剰取得の防止)", async () => {
    findCardCandidates.mockResolvedValueOnce([]);

    const evidence = await retrieveEvidence(makeParsedQuestion([], [], ["無視する"]));

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).not.toContain(
      "ignore-ability-does-not-cancel-already-waiting-triggered-ability",
    );
  });

  it("負例(2026-09-04追加): カード名が1枚も一致しなければ「能力を無視する」原則は注入されない", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(makeCard({ id: "c", name: "無関係なカード" }), "exact", 1),
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion(["無関係なカード"], [], []));

    expect(evidence.verifiedRulingPrinciples.map((p) => p.itemKey)).not.toContain(
      "ignore-ability-does-not-cancel-already-waiting-triggered-ability",
    );
  });

  it("カードテキスト由来の概念(cardDerivedConcepts)だけでは検証済み裁定原則を注入しない(質問の論点と無関係な過剰取得の防止)", async () => {
    findCardCandidates.mockResolvedValueOnce([
      makeMatch(
        makeCard({
          id: "a",
          name: "テストクリーチャー",
          cardText: "W・ブレイカー\nこのクリーチャーが攻撃する時、カードを1枚引く。",
        }),
        "exact",
        1,
      ),
    ]);

    // parsed.ruleConceptsは空(質問文自体には「W・ブレイカー」等への言及がない)。
    const evidence = await retrieveEvidence(makeParsedQuestion(["テストクリーチャー"], [], []));

    expect(evidence.verifiedRulingPrinciples).toHaveLength(0);
  });
});

describe("retrieveEvidence の過去の訂正事例(pastCorrections)のtitle(T008)", () => {
  it("judgeIdをtitleへ含めない(公開APIや利用統計経由でジャッジIDが露出するのを防ぐ)", async () => {
    searchAndRankCorrections.mockReturnValueOnce([
      {
        id: 42,
        originalQuestion: "元の質問",
        botConclusion: "誤った結論",
        correctRuling: "正しい裁定",
        cardNames: [],
        correctedBy: "J001",
        judgeId: "J001",
        createdAt: 0,
        score: 12,
      },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion([]));

    expect(evidence.pastCorrections).toHaveLength(1);
    expect(evidence.pastCorrections[0].title).toBe("過去の訂正事例 #42(公認ジャッジによる記録)");
    expect(evidence.pastCorrections[0].title).not.toContain("J001");
  });

  it("複数の訂正がヒットしても、それぞれ異なるtitleになる(produceRuling.tsのbyEmptyUrlTitle照合での誤帰属防止)", async () => {
    searchAndRankCorrections.mockReturnValueOnce([
      {
        id: 1,
        originalQuestion: "質問1",
        botConclusion: "誤った結論1",
        correctRuling: "正しい裁定1",
        cardNames: [],
        correctedBy: "J001",
        judgeId: "J001",
        createdAt: 0,
        score: 12,
      },
      {
        id: 2,
        originalQuestion: "質問2",
        botConclusion: "誤った結論2",
        correctRuling: "正しい裁定2",
        cardNames: [],
        correctedBy: "J002",
        judgeId: "J002",
        createdAt: 0,
        score: 12,
      },
    ]);

    const evidence = await retrieveEvidence(makeParsedQuestion([]));

    const titles = evidence.pastCorrections.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
