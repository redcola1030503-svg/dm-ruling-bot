import { describe, expect, it } from "vitest";
import { extractJsonBlock } from "../src/llm/jsonExtract";

describe("extractJsonBlock", () => {
  it("純粋なJSONはそのまま返す", () => {
    expect(extractJsonBlock('{"a": 1}')).toBe('{"a": 1}');
  });

  it("コードブロック(```json)からJSONを取り出す", () => {
    const text = '```json\n{"a": 1}\n```';
    expect(JSON.parse(extractJsonBlock(text))).toEqual({ a: 1 });
  });

  it("前置きの説明文がある場合でもJSON部分だけを取り出す", () => {
    const text = 'この状況は公式Q&Aと一致しています。\n\n{"a": 1, "b": {"c": 2}}';
    expect(JSON.parse(extractJsonBlock(text))).toEqual({ a: 1, b: { c: 2 } });
  });

  it("前後に説明文がある場合でもJSON部分だけを取り出す", () => {
    const text = '回答します。\n{"a": 1}\n以上です。';
    expect(JSON.parse(extractJsonBlock(text))).toEqual({ a: 1 });
  });
});
