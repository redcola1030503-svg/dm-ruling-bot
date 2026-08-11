import { describe, expect, it, vi } from "vitest";
import type { RulingEvidence } from "../src/ruling/types";

const analyzeQuestion = vi.fn();
const retrieveEvidence = vi.fn();
const generateRuling = vi.fn();

vi.mock("../src/ruling/analyzeQuestion", () => ({ analyzeQuestion: (q: string) => analyzeQuestion(q) }));
vi.mock("../src/ruling/retrieveEvidence", () => ({
  retrieveEvidence: (q: unknown) => retrieveEvidence(q),
}));
vi.mock("../src/ruling/generateRuling", () => ({
  generateRuling: (q: unknown, e: unknown) => generateRuling(q, e),
}));

const { produceRuling } = await import("../src/ruling/produceRuling");

function makeEvidence(overrides: Partial<RulingEvidence>): RulingEvidence {
  return {
    cards: [],
    qa: [],
    ruleChanges: [],
    generalRules: [],
    pastCorrections: [],
    ambiguousCards: [],
    ...overrides,
  };
}

describe("produceRuling のカード名確認フロー", () => {
  it("ambiguousCardsがある場合はLLMを呼ばずneeds_clarificationを返す", async () => {
    analyzeQuestion.mockResolvedValueOnce({
      originalText: "q",
      cardNames: ["ベートーベン"],
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
