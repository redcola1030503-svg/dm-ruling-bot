/**
 * LLMがコードブロック(```json ... ```)や前置きの説明文付きで返した場合でも
 * JSON本体を取り出す。
 */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) return codeBlockMatch[1].trim();

  // コードブロックがない場合、最初の "{" から最後の "}" までを抽出する
  // (指示に反してLLMがJSONの前後に説明文を付けてしまうケースへの対処)。
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}
