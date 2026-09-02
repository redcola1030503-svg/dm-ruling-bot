import { DMWIKI_KEYWORD_ABILITY_NAMES } from "./keywordAbilityNames";

/**
 * 代表的なルール用語の辞書。質問文からの簡易抽出に使う。
 * 本格的な質問構造化(同義語・表記ゆれの吸収含む)はPhase5のanalyzeQuestionで行う。
 */
const BASE_RULE_CONCEPTS: readonly string[] = [
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
  "使用宣言",
  "追加ターン",
  // 語幹までのマッチにして「攻撃できない/できなく/できなかった」等の活用ゆれを拾う
  "攻撃できな",
  "ブロックできな",
  "参加できな",
];

// 公式キーワード能力一覧(https://dmwiki.net/キーワード能力、keywordAbilityNames.tsに分離)を
// 網羅的に追加する。上記BASE_RULE_CONCEPTSで既出のもの(S・トリガー/革命チェンジ/ブロッカー/
// W・ブレイカー/T・ブレイカー/進化/マナ武装)はkeywordAbilityNames.ts側で除外済み。
const RULE_CONCEPTS: readonly string[] = [...BASE_RULE_CONCEPTS, ...DMWIKI_KEYWORD_ABILITY_NAMES];

export function extractRuleConcepts(question: string): string[] {
  return RULE_CONCEPTS.filter((concept) => question.includes(concept));
}
