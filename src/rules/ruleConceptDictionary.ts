/**
 * 代表的なルール用語の辞書。質問文からの簡易抽出に使う。
 * 本格的な質問構造化(同義語・表記ゆれの吸収含む)はPhase5のanalyzeQuestionで行う。
 */
const RULE_CONCEPTS: readonly string[] = [
  "S・トリガー",
  "S トリガー",
  "G・ストライク",
  "革命チェンジ",
  "置換効果",
  "出た時",
  "離れた時",
  "攻撃する時",
  "ブロックする時",
  "同時",
  "ブロッカー",
  "W・ブレイカー",
  "T・ブレイカー",
  "シールド",
  "ブレイク",
  "マナ武装",
  "進化",
  "山札の上",
  "山札の下",
  "手札に加える",
  "墓地に置く",
  "タップ",
  "アンタップ",
  "パワー",
  "コスト",
  "無視する",
  "選ばれない",
  "召喚できない",
  "唱えられない",
  "できない",
];

export function extractRuleConcepts(question: string): string[] {
  return RULE_CONCEPTS.filter((concept) => question.includes(concept));
}
