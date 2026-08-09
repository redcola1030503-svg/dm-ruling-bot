import type { RulingResult } from "../ruling/types";

const LINE_TEXT_MAX_LENGTH = 4500;
const MAX_SOURCES = 5;

const CONFIDENCE_LABEL: Record<RulingResult["confidence"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export function formatRulingForLine(result: RulingResult): string {
  const parts: string[] = [];

  parts.push(`【結論】\n\n${result.conclusion}`);

  if (result.explanation) {
    parts.push(`【理由】\n\n${result.explanation}`);
  }

  if (result.steps.length > 0) {
    const stepsText = result.steps.map((step, i) => `${toCircledNumber(i + 1)} ${step}`).join("\n↓\n");
    parts.push(`【処理順】\n\n${stepsText}`);
  }

  parts.push(`確度：${CONFIDENCE_LABEL[result.confidence]}`);

  if (result.sources.length > 0) {
    const sourcesText = result.sources
      .slice(0, MAX_SOURCES)
      .map((source) => `・${source.title}\n${source.url}`)
      .join("\n\n");
    parts.push(`【公式情報】\n\n${sourcesText}`);
  }

  const text = parts.join("\n\n");
  if (text.length <= LINE_TEXT_MAX_LENGTH) return text;
  return `${text.slice(0, LINE_TEXT_MAX_LENGTH - 1)}…`;
}

const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function toCircledNumber(n: number): string {
  return CIRCLED_NUMBERS[n - 1] ?? `${n}.`;
}
