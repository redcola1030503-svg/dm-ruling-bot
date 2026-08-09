const BRACKET_PATTERNS = [/《([^》]+)》/g, /「([^」]+)」/g, /『([^』]+)』/g];

/**
 * 質問文中の括弧表記からカード名候補の文字列を抽出する簡易版。
 * 本格的な質問構造化はPhase5のanalyzeQuestionで行う。
 */
export function extractCardNameCandidates(question: string): string[] {
  const names = new Set<string>();
  for (const pattern of BRACKET_PATTERNS) {
    for (const match of question.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}
