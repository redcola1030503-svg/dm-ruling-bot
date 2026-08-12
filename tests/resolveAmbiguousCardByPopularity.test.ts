import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
vi.mock("../src/llm/client", () => ({
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

const { resolvePopularCardName } = await import("../src/cards/resolveAmbiguousCardByPopularity");

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("resolvePopularCardName", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("very_highの確信度で候補内の名前が返れば、そのカード名を返す", async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          resolved_card_name: "「修羅」の頂 VAN・ベートーベン",
          confidence: "very_high",
          reason: "大会結果で圧倒的に多く採用されている",
        }),
      ),
    );

    const resolved = await resolvePopularCardName("ベートーベン", [
      "ベートーベン・キューブ",
      "「修羅」の頂 VAN・ベートーベン",
    ]);

    expect(resolved).toBe("「修羅」の頂 VAN・ベートーベン");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5",
        tools: [expect.objectContaining({ type: "web_search_20260209" })],
      }),
    );
  });

  it("confidenceがvery_high以外の場合はnullを返す(従来通り確認にフォールバック)", async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          resolved_card_name: "ベートーベン・キューブ",
          confidence: "moderate",
          reason: "差が僅か",
        }),
      ),
    );

    const resolved = await resolvePopularCardName("ベートーベン", [
      "ベートーベン・キューブ",
      "「修羅」の頂 VAN・ベートーベン",
    ]);

    expect(resolved).toBeNull();
  });

  it("resolved_card_nameが候補に含まれない場合はnullを返す", async () => {
    createMock.mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          resolved_card_name: "別のカード",
          confidence: "very_high",
          reason: "誤って候補外を返したケース",
        }),
      ),
    );

    const resolved = await resolvePopularCardName("ベートーベン", [
      "ベートーベン・キューブ",
      "「修羅」の頂 VAN・ベートーベン",
    ]);

    expect(resolved).toBeNull();
  });

  it("テキストブロックがJSONとして解析できない場合はnullを返す", async () => {
    createMock.mockResolvedValueOnce(textResponse("すみません、判断できませんでした。"));

    const resolved = await resolvePopularCardName("ベートーベン", [
      "ベートーベン・キューブ",
      "「修羅」の頂 VAN・ベートーベン",
    ]);

    expect(resolved).toBeNull();
  });

  it("API呼び出しが失敗した場合はnullを返す(例外を投げない)", async () => {
    createMock.mockRejectedValueOnce(new Error("network error"));

    const resolved = await resolvePopularCardName("ベートーベン", [
      "ベートーベン・キューブ",
      "「修羅」の頂 VAN・ベートーベン",
    ]);

    expect(resolved).toBeNull();
  });

  it("候補が2件未満の場合はAPIを呼ばずにnullを返す", async () => {
    const resolved = await resolvePopularCardName("ベートーベン", ["ベートーベン・キューブ"]);

    expect(resolved).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});
