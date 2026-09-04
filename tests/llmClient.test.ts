import { beforeEach, describe, expect, it, vi } from "vitest";

const messagesCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => messagesCreate(...args) };
  },
}));

vi.mock("../src/config/env", () => ({
  env: { LLM_API_KEY: "test-key" },
}));

const { completeJson } = await import("../src/llm/client");

function makeMessage(text: string) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe("completeJson", () => {
  beforeEach(() => {
    messagesCreate.mockReset();
  });

  it("Anthropic messages.createへ明示的なtimeoutオプションを渡す(T012: 孤立ジョブ回収が正常なジョブを誤確定しないための安全策)", async () => {
    messagesCreate.mockResolvedValue(makeMessage("結果"));

    await completeJson({ system: "system", userMessage: "question", label: "test" });

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5" }),
      expect.objectContaining({ timeout: 3 * 60 * 1000 }),
    );
  });

  it("maxRetries:0も渡し、SDKの既定再試行でtimeoutが実質的に倍増しないようにする(Codexレビュー指摘、2026-09-04)", async () => {
    messagesCreate.mockResolvedValue(makeMessage("結果"));

    await completeJson({ system: "system", userMessage: "question", label: "test" });

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-5" }),
      expect.objectContaining({ maxRetries: 0 }),
    );
  });

  it("Batch API関連の分岐は存在せず、常にmessages.createのみが呼ばれる", async () => {
    messagesCreate.mockResolvedValue(makeMessage("結果"));

    const result = await completeJson({ system: "system", userMessage: "question", label: "test" });

    expect(result).toBe("結果");
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });
});
