import { normalizeCardName } from "../utils/normalize";
import { similarityScore } from "../utils/textSimilarity";
import { getOfficialCard, searchOfficialCards } from "./cardSearch";
import type { CardFace, CardInfo, CardSearchHit } from "./types";

export type CardMatchType = "exact" | "prefix" | "partial" | "fuzzy";

export type CardNameMatch = {
  card: CardInfo;
  /** 入力名に実際にマッチした面(表/裏)。裏面名で一致した場合、表面ではなくこの面の属性を裁定に使う。 */
  matchedFace: CardFace;
  matchType: CardMatchType;
  score: number;
};

const FUZZY_MIN_SCORE = 0.5;

function scoreNameAgainst(
  candidateName: string,
  normalizedInput: string,
): { matchType: CardMatchType; score: number } | null {
  const normalizedName = normalizeCardName(candidateName);

  if (normalizedName === normalizedInput) {
    return { matchType: "exact", score: 1 };
  }
  if (normalizedName.startsWith(normalizedInput) || normalizedInput.startsWith(normalizedName)) {
    return { matchType: "prefix", score: 0.9 };
  }
  if (normalizedName.includes(normalizedInput) || normalizedInput.includes(normalizedName)) {
    return { matchType: "partial", score: 0.75 };
  }
  const similarity = similarityScore(normalizedName, normalizedInput);
  if (similarity >= FUZZY_MIN_SCORE) {
    return { matchType: "fuzzy", score: similarity * 0.6 };
  }
  return null;
}

/**
 * サイキック・ドラグハート・ツインパクト等、複数の面(名前・属性)を持つ
 * カードは、どの面の名前で入力されてもマッチできるよう、facesのうち
 * 最もスコアが高いものを採用する。マッチした面(matchedFace)を結果に
 * 含めることで、呼び出し側が入力名と対応する面の属性(文明・パワー等)を
 * 正しく使えるようにする(表面名で来た質問に裏面の属性が渡る、またはその
 * 逆の誤りを防ぐ)。
 */
function scoreCardsAgainst(cards: CardInfo[], inputName: string): CardNameMatch[] {
  const normalizedInput = normalizeCardName(inputName);
  const matches: CardNameMatch[] = [];

  for (const card of cards) {
    let best: { face: CardFace; matchType: CardMatchType; score: number } | null = null;
    for (const face of card.faces) {
      const current = scoreNameAgainst(face.name, normalizedInput);
      if (current && (!best || current.score > best.score)) {
        best = { face, ...current };
      }
    }
    if (best) {
      matches.push({ card, matchedFace: best.face, matchType: best.matchType, score: best.score });
    }
  }

  return matches;
}

async function fetchCards(hits: CardSearchHit[]): Promise<CardInfo[]> {
  return (await Promise.all(hits.map((hit) => getOfficialCard(hit)))).filter(
    (card): card is CardInfo => card !== null,
  );
}

export async function findCardCandidates(
  inputName: string,
  options?: { maxResults?: number },
): Promise<CardNameMatch[]> {
  // maxResultsは検索結果の絞り込みではなく、スコアリング後の絞り込みに使う。
  // 公式サイト検索の結果順は関連度順ではないため、先に絞り込むと
  // 名称完全一致のカードが件数制限で切り捨てられることがある
  // (例:「ボルシャック・ドラゴン」で検索すると派生カードが多く、
  // 完全一致の本家カードが検索結果の後方に出る)。
  const hits = await searchOfficialCards(inputName);
  const cards = await fetchCards(hits);
  const matches = scoreCardsAgainst(cards, inputName);
  matches.sort((a, b) => b.score - a.score);
  return options?.maxResults ? matches.slice(0, options.maxResults) : matches;
}
