// NFKCはアポストロフィ・クォーテーション類の異体字(U+2019右シングルクォーテーション、
// U+2018左シングルクォーテーション、U+FF07全角アポストロフィ等)をU+0027に正規化しない。
// カード名(例:「頂上混成 ガリュディアス・モモミーズ'22」)にこれらが使われることがあり、
// 入力側と公式サイト側で異なる文字が使われていると一致判定に失敗するため、明示的に統一する。
const APOSTROPHE_VARIANTS = /[‘’ʼ＇]/g;

export function normalizeCardName(input: string): string {
  return input
    .normalize("NFKC")
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(/[\s・「」『』]+/g, "")
    .toLowerCase();
}
