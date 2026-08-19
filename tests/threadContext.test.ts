import { describe, expect, it } from "vitest";
import { buildFollowUpQuestion } from "../src/ruling/threadContext";
import type { RulingJobRow } from "../src/ruling/rulingJobRepository";

function doneJob(question: string, conclusion: string): RulingJobRow {
  return {
    id: "job",
    device_id: "device-1",
    question,
    status: "done",
    outcome_status: "ok",
    result_json: JSON.stringify({
      conclusion,
      explanation: "",
      steps: [],
      confidence: "high",
      cards: [],
      sources: [],
    }),
    error: null,
    notified_at: null,
    thread_id: "thread-1",
    created_at: Date.now(),
    started_at: Date.now(),
    finished_at: Date.now(),
  };
}

describe("buildFollowUpQuestion", () => {
  it("過去のやり取りが無ければ最新質問をそのまま返す", () => {
    expect(buildFollowUpQuestion([], "新しい質問")).toBe("新しい質問");
  });

  it("done状態のジョブのみ文脈に含める", () => {
    const pending: RulingJobRow = { ...doneJob("保留中の質問", ""), status: "pending", result_json: null };
    const result = buildFollowUpQuestion([doneJob("最初の質問", "最初の結論"), pending], "追加の質問");

    expect(result).toContain("これまでの会話:");
    expect(result).toContain("ユーザー: 最初の質問");
    expect(result).toContain("Bot: 最初の結論");
    expect(result).not.toContain("保留中の質問");
    expect(result).toContain("新しい質問:\n追加の質問");
  });

  it("直近6件のみを文脈に含める", () => {
    const jobs = Array.from({ length: 8 }, (_, i) => doneJob(`質問${i}`, `結論${i}`));
    const result = buildFollowUpQuestion(jobs, "最新の質問");

    expect(result).not.toContain("質問0");
    expect(result).not.toContain("質問1");
    expect(result).toContain("質問2");
    expect(result).toContain("質問7");
  });

  it("result_jsonが不正なジョブはスキップする", () => {
    const broken: RulingJobRow = { ...doneJob("壊れた質問", ""), result_json: "not-json" };
    const result = buildFollowUpQuestion([broken], "新しい質問");

    expect(result).toBe("新しい質問");
  });
});
