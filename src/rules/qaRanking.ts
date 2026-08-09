import { scoreTextMatch, type MatchCriteria } from "../utils/scoring";
import { fetchQaListForCard, getQaDetail, searchQaByKeyword } from "./qaSearch";
import type { QaDetail, QaEvidence, QaListItem } from "./types";

export type QaSearchCriteria = MatchCriteria;

// 公式がカード詳細ページで直接紐付けたQ&Aは、キーワード一致がなくても優先的に採用する。
const CARD_LINKED_QA_BONUS = 8;

// 検索語(≒公式サイトへのリクエスト数)が多くなりすぎないよう上限を設ける。
// カード名 > ルール用語 > キーワードの優先順で、この数までに絞る。
const MAX_SEARCH_TERMS = 8;

async function collectListItems(
  criteria: QaSearchCriteria,
  maxResultsPerTerm: number,
  cardQaListUrls: string[],
): Promise<{ items: QaListItem[]; cardLinkedIds: Set<string> }> {
  const searchTerms = [...criteria.cardNames, ...criteria.ruleConcepts, ...criteria.keywords]
    .filter((term) => term.trim().length > 0)
    .slice(0, MAX_SEARCH_TERMS);

  const [resultsByTerm, cardLinkedResults] = await Promise.all([
    Promise.all(searchTerms.map((term) => searchQaByKeyword(term, { maxResults: maxResultsPerTerm }))),
    Promise.all(cardQaListUrls.map((url) => fetchQaListForCard(url))),
  ]);

  const seen = new Map<string, QaListItem>();
  const cardLinkedIds = new Set<string>();

  for (const items of cardLinkedResults) {
    for (const item of items) {
      seen.set(item.id, item);
      cardLinkedIds.add(item.id);
    }
  }
  for (const items of resultsByTerm) {
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.set(item.id, item);
      }
    }
  }

  return { items: Array.from(seen.values()), cardLinkedIds };
}

export async function searchAndRankQa(
  criteria: QaSearchCriteria,
  options?: { maxResultsPerTerm?: number; topN?: number; cardQaListUrls?: string[] },
): Promise<QaEvidence[]> {
  const { items: listItems, cardLinkedIds } = await collectListItems(
    criteria,
    options?.maxResultsPerTerm ?? 10,
    options?.cardQaListUrls ?? [],
  );

  const details = (await Promise.all(listItems.map((item) => getQaDetail(item)))).filter(
    (qa): qa is QaDetail => qa !== null,
  );

  const scored: QaEvidence[] = details.map((qa) => ({
    ...qa,
    score:
      scoreTextMatch(`${qa.question} ${qa.answer}`, criteria) +
      (cardLinkedIds.has(qa.id) ? CARD_LINKED_QA_BONUS : 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options?.topN ?? 10);
}
