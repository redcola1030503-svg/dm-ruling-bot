import { findCardCandidates } from "../cards/cardNameMatcher";
import { env } from "../config/env";
import { searchAndRankQa } from "../rules/qaRanking";
import { searchAndRankRuleChanges } from "../rules/ruleChangeRanking";
import { searchAndRankGeneralRules } from "../rules/generalRuleRanking";
import { extractRuleConcepts } from "../rules/ruleConceptDictionary";
import { searchAndRankCorrections } from "../corrections/ranking";
import type { EvidenceSource, ParsedQuestion, RulingEvidence, ScoredEvidenceSource } from "./types";

const CARD_MATCH_MIN_SCORE = 0.75; // prefix一致相当以上のみ採用(誤ったカードを勝手に確定しない)

export async function retrieveEvidence(parsed: ParsedQuestion): Promise<RulingEvidence> {
  const cardResults = await Promise.all(
    parsed.cardNames.map((name) => findCardCandidates(name, { maxResults: 5 })),
  );

  const cards: EvidenceSource[] = [];
  const cardQaListUrls: string[] = [];
  const cardDerivedConcepts = new Set<string>();
  const seenCardIds = new Set<string>();
  for (const matches of cardResults) {
    const best = matches[0];
    if (!best || best.score < CARD_MATCH_MIN_SCORE) continue;
    if (seenCardIds.has(best.card.id)) continue;
    seenCardIds.add(best.card.id);
    cards.push({
      title: best.card.name,
      text: `文明:${best.card.civilization} 種類:${best.card.cardType} コスト:${best.card.cost} パワー:${best.card.power} 種族:${best.card.race}\n${best.card.cardText}`,
      url: best.card.url,
      sourceType: "card",
    });
    if (best.card.qaListUrl) {
      cardQaListUrls.push(best.card.qaListUrl);
    }
    // カードテキスト自体に含まれる特徴的な効果語(「無視する」等)も検索キーワードに
    // 加える。質問文には現れないが、カードの基本効果を理解する上で重要なQ&Aを
    // 拾うための補完(例: 「無視する」能力の解釈Q&A)。
    for (const concept of extractRuleConcepts(best.card.cardText)) {
      cardDerivedConcepts.add(concept);
    }
  }

  const criteria = {
    cardNames: parsed.cardNames,
    ruleConcepts: Array.from(new Set([...parsed.ruleConcepts, ...cardDerivedConcepts])),
    keywords: parsed.keywords,
  };

  const [qaResults, ruleChangeResults, generalRuleResults] = await Promise.all([
    searchAndRankQa(criteria, { cardQaListUrls }),
    searchAndRankRuleChanges(criteria),
    searchAndRankGeneralRules(criteria),
  ]);

  const qa: ScoredEvidenceSource[] = qaResults.map((item) => ({
    title: item.question.slice(0, 60),
    text: `Q: ${item.question}\nA: ${item.answer}`,
    url: item.url,
    sourceType: "qa",
    score: item.score,
  }));

  const ruleChanges: ScoredEvidenceSource[] = ruleChangeResults.map((item) => ({
    title: item.title,
    text: item.body,
    url: item.url,
    sourceType: "ruleChange",
    score: item.score,
  }));

  const generalRules: ScoredEvidenceSource[] = generalRuleResults.map((chunk) => ({
    title: `総合ルール ${chunk.ruleNumber}`,
    text: chunk.text,
    url: env.DM_GENERAL_RULE_PAGE_URL,
    sourceType: "generalRule",
    score: chunk.score,
  }));

  // 過去にジャッジが訂正した実績。公式情報ではないため、URLは持たせずsourcesには
  // 出力させない(generateRuling側でurlの無いEvidenceはsourcesから自動除外される)。
  const correctionResults = searchAndRankCorrections(criteria);
  const pastCorrections: ScoredEvidenceSource[] = correctionResults.map((correction) => ({
    title: `過去の訂正事例(ジャッジID: ${correction.judgeId})`,
    text: `質問: ${correction.originalQuestion}\nBotの誤った結論: ${correction.botConclusion}\n正しい裁定: ${correction.correctRuling}`,
    url: "",
    sourceType: "correction",
    score: correction.score,
  }));

  return { cards, qa, ruleChanges, generalRules, pastCorrections };
}
