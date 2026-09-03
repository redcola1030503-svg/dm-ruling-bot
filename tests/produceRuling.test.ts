import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RulingEvidence } from "../src/ruling/types";

const analyzeQuestion = vi.fn();
const retrieveEvidence = vi.fn();
const generateRuling = vi.fn();
const recordCardQuery = vi.fn();
const recordSourceReference = vi.fn();

vi.mock("../src/ruling/analyzeQuestion", () => ({ analyzeQuestion: (q: string) => analyzeQuestion(q) }));
vi.mock("../src/ruling/retrieveEvidence", () => ({
  retrieveEvidence: (q: unknown) => retrieveEvidence(q),
}));
vi.mock("../src/ruling/generateRuling", () => ({
  generateRuling: (q: unknown, e: unknown) => generateRuling(q, e),
}));
vi.mock("../src/stats/statsRepository", () => ({
  recordCardQuery: (...args: unknown[]) => recordCardQuery(...args),
  recordSourceReference: (...args: unknown[]) => recordSourceReference(...args),
}));

const { produceRuling } = await import("../src/ruling/produceRuling");

function makeEvidence(overrides: Partial<RulingEvidence>): RulingEvidence {
  return {
    cards: [],
    qa: [],
    ruleChanges: [],
    generalRules: [],
    pastCorrections: [],
    keywordAbilities: [],
    verifiedRulingPrinciples: [],
    ambiguousCards: [],
    ...overrides,
  };
}

describe("produceRuling のカード名確認フロー", () => {
  beforeEach(() => {
    analyzeQuestion.mockReset();
    retrieveEvidence.mockReset();
    generateRuling.mockReset();
    recordCardQuery.mockReset();
    recordSourceReference.mockReset();
  });

  it("ambiguousCardsがある場合はLLMを呼ばずneeds_clarificationを返す", async () => {
    analyzeQuestion.mockResolvedValueOnce({
      originalText: "q",
      cardNames: ["ベートーベン"],
      weakCardNames: [],
      keywords: [],
      ruleConcepts: [],
      situation: "",
      question: "q",
    });
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        ambiguousCards: [{ queried: "ベートーベン", candidates: ["ベートーベン・キューブ", "VAN・ベートーベン"] }],
      }),
    );

    const outcome = await produceRuling("ベートーベンの効果は?");

    expect(outcome.status).toBe("needs_clarification");
    expect(outcome.result.conclusion).toContain("確定できません");
    expect(outcome.result.explanation).toContain("ベートーベン・キューブ");
    expect(outcome.result.explanation).toContain("VAN・ベートーベン");
    expect(generateRuling).not.toHaveBeenCalled();
  });

  it("ambiguousCardsが無い場合は通常通りgenerateRulingを呼ぶ", async () => {
    analyzeQuestion.mockResolvedValueOnce({
      originalText: "q",
      cardNames: ["斬隠蒼頭龍バイケン"],
      weakCardNames: [],
      keywords: [],
      ruleConcepts: [],
      situation: "",
      question: "q",
    });
    retrieveEvidence.mockResolvedValueOnce(makeEvidence({}));
    generateRuling.mockResolvedValueOnce({
      conclusion: "結論",
      explanation: "説明",
      steps: [],
      confidence: "high",
      cards: [],
      sources: [],
    });

    const outcome = await produceRuling("バイケンの効果は?");

    expect(outcome.status).toBe("ok");
    expect(generateRuling).toHaveBeenCalledTimes(1);
  });
});

describe("produceRuling の統計記録", () => {
  beforeEach(() => {
    analyzeQuestion.mockReset();
    retrieveEvidence.mockReset();
    generateRuling.mockReset();
    recordCardQuery.mockReset();
    recordSourceReference.mockReset();
  });

  function baseParsedQuestion(cardNames: string[]) {
    return {
      originalText: "q",
      cardNames,
      weakCardNames: [],
      keywords: [],
      ruleConcepts: [],
      situation: "",
      question: "q",
    };
  }

  it("evidence.cardsが一意に確定した各カードについてrecordCardQueryを呼ぶ", async () => {
    analyzeQuestion.mockResolvedValueOnce(baseParsedQuestion(["ボルシャック・ドラゴン"]));
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        cards: [
          {
            title: "ボルシャック・ドラゴン",
            text: "...",
            url: "https://example.com/card/a",
            sourceType: "card",
            itemKey: "card-a",
          },
        ],
      }),
    );
    generateRuling.mockResolvedValueOnce({
      conclusion: "結論",
      explanation: "説明",
      steps: [],
      confidence: "high",
      cards: [],
      sources: [],
    });

    await produceRuling("ボルシャック・ドラゴンの効果は?");

    expect(recordCardQuery).toHaveBeenCalledWith(
      "card-a",
      "ボルシャック・ドラゴン",
      "https://example.com/card/a",
    );
  });

  it("ambiguousCardsのみの場合はrecordCardQueryを呼ばない", async () => {
    analyzeQuestion.mockResolvedValueOnce(baseParsedQuestion(["ベートーベン"]));
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        ambiguousCards: [{ queried: "ベートーベン", candidates: ["ベートーベン・キューブ"] }],
      }),
    );

    await produceRuling("ベートーベンの効果は?");

    expect(recordCardQuery).not.toHaveBeenCalled();
  });

  it("result.sourcesがevidenceのurlと一致する場合、その種別・itemKeyでrecordSourceReferenceを呼ぶ", async () => {
    analyzeQuestion.mockResolvedValueOnce(baseParsedQuestion([]));
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        generalRules: [
          {
            title: "総合ルール 509.2c",
            text: "...",
            url: "https://example.com/rule",
            sourceType: "generalRule",
            itemKey: "509.2c",
            score: 1,
          },
        ],
        qa: [
          {
            title: "Q1",
            text: "...",
            url: "https://example.com/qa/1",
            sourceType: "qa",
            itemKey: "https://example.com/qa/1",
            score: 1,
          },
        ],
      }),
    );
    generateRuling.mockResolvedValueOnce({
      conclusion: "結論",
      explanation: "説明",
      steps: [],
      confidence: "high",
      cards: [],
      sources: [
        { title: "総合ルール 509.2c", url: "https://example.com/rule" },
        { title: "無関係なURL", url: "https://example.com/unknown" },
      ],
    });

    await produceRuling("質問");

    expect(recordSourceReference).toHaveBeenCalledTimes(1);
    expect(recordSourceReference).toHaveBeenCalledWith(
      "generalRule",
      "509.2c",
      "総合ルール 509.2c",
      "https://example.com/rule",
    );
  });

  it("url空文字の訂正事例はタイトル一致でrecordSourceReferenceを呼ぶ", async () => {
    analyzeQuestion.mockResolvedValueOnce(baseParsedQuestion([]));
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        pastCorrections: [
          {
            title: "過去の訂正事例(公認ジャッジによる記録)",
            text: "...",
            url: "",
            sourceType: "correction",
            itemKey: "42",
            score: 12,
          },
        ],
      }),
    );
    generateRuling.mockResolvedValueOnce({
      conclusion: "結論",
      explanation: "説明",
      steps: [],
      confidence: "high",
      cards: [],
      sources: [{ title: "過去の訂正事例(公認ジャッジによる記録)", url: "" }],
    });

    await produceRuling("質問");

    expect(recordSourceReference).toHaveBeenCalledWith(
      "correction",
      "42",
      "過去の訂正事例(公認ジャッジによる記録)",
      "",
    );
  });

  it("url空文字の検証済み裁定原則(D-006)もタイトル一致でrecordSourceReferenceを呼ぶ", async () => {
    analyzeQuestion.mockResolvedValueOnce(baseParsedQuestion([]));
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        verifiedRulingPrinciples: [
          {
            title: "複数の置換効果が異なるイベントに適用される場合の決定順",
            text: "...",
            url: "",
            sourceType: "verifiedRulingPrinciple",
            itemKey: "replacement-effect-order-multiple-events",
          },
        ],
      }),
    );
    generateRuling.mockResolvedValueOnce({
      conclusion: "結論",
      explanation: "説明",
      steps: [],
      confidence: "high",
      cards: [],
      sources: [{ title: "複数の置換効果が異なるイベントに適用される場合の決定順", url: "" }],
    });

    await produceRuling("質問");

    expect(recordSourceReference).toHaveBeenCalledWith(
      "verifiedRulingPrinciple",
      "replacement-effect-order-multiple-events",
      "複数の置換効果が異なるイベントに適用される場合の決定順",
      "",
    );
  });

  it("needs_clarificationの場合はrecordSourceReferenceを呼ばない", async () => {
    analyzeQuestion.mockResolvedValueOnce(baseParsedQuestion(["ベートーベン"]));
    retrieveEvidence.mockResolvedValueOnce(
      makeEvidence({
        ambiguousCards: [{ queried: "ベートーベン", candidates: ["ベートーベン・キューブ"] }],
      }),
    );

    await produceRuling("ベートーベンの効果は?");

    expect(recordSourceReference).not.toHaveBeenCalled();
  });
});
