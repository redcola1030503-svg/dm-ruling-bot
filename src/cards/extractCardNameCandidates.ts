const STRONG_BRACKET_PATTERN = /《([^》]+)》/g;
const WEAK_BRACKET_PATTERNS = [/「([^」]+)」/g, /『([^』]+)』/g];

export type BracketCardNameCandidates = {
  /** 《》由来。公式カード名表記として使われる慣習が強いため、確定できなければ確認を促してよい候補。 */
  strong: string[];
  /** 「」『』由来。一般名詞や能力名を囲む場合も多いため、確定できなくても質問全体を止めてはならない候補。 */
  weak: string[];
};

/**
 * 質問文中の括弧表記からカード名候補の文字列を、強弱を区別して抽出する。
 * 《》は公式カード名表記の慣習が強いためstrong、「」『』は「侵略」「猫」のような
 * 一般名詞・能力名を囲むのにも使われるためweakとして分ける
 * (カード名自体が「」を含むこともあるため、「」を一律で無視してはならない)。
 * 本格的な質問構造化はPhase5のanalyzeQuestionで行う。
 */
export function extractCardNameCandidatesTiered(question: string): BracketCardNameCandidates {
  const strong = new Set<string>();
  for (const match of question.matchAll(STRONG_BRACKET_PATTERN)) {
    const name = match[1]?.trim();
    if (name) strong.add(name);
  }
  const weak = new Set<string>();
  for (const pattern of WEAK_BRACKET_PATTERNS) {
    for (const match of question.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (name && !strong.has(name)) weak.add(name);
    }
  }
  return { strong: Array.from(strong), weak: Array.from(weak) };
}

/**
 * 質問文中の括弧表記(《》「」『』すべて)からカード名候補の文字列を抽出する簡易版。
 * 訂正記録・デバッグ表示など、strong/weakを区別せず広く候補を拾いたい用途向け。
 * カード名解決(analyzeQuestion→retrieveEvidence)では代わりにextractCardNameCandidatesTieredを使うこと。
 */
export function extractCardNameCandidates(question: string): string[] {
  const { strong, weak } = extractCardNameCandidatesTiered(question);
  return Array.from(new Set([...strong, ...weak]));
}
