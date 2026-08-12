import { findCardCandidates } from "../cards/cardNameMatcher";
import { resolvePopularCardName } from "../cards/resolveAmbiguousCardByPopularity";
import { env } from "../config/env";
import { searchAndRankQa } from "../rules/qaRanking";
import { searchAndRankRuleChanges } from "../rules/ruleChangeRanking";
import { extractRuleConcepts } from "../rules/ruleConceptDictionary";
import { searchAndRankCorrections } from "../corrections/ranking";
import { hybridSearchGeneralRules } from "../search/hybridSearch";
import type {
  AmbiguousCard,
  EvidenceSource,
  ParsedQuestion,
  RulingEvidence,
  ScoredEvidenceSource,
} from "./types";

const CARD_MATCH_MIN_SCORE = 0.75; // prefix一致相当以上のみ採用(誤ったカードを勝手に確定しない)
const EXACT_MATCH_SCORE = 1;
const AMBIGUOUS_CANDIDATE_LIMIT = 3;

export async function retrieveEvidence(parsed: ParsedQuestion): Promise<RulingEvidence> {
  const cardResults = await Promise.all(
    parsed.cardNames.map((name) => findCardCandidates(name, { maxResults: 5 })),
  );

  const cards: EvidenceSource[] = [];
  const cardQaListUrls: string[] = [];
  const cardDerivedConcepts = new Set<string>();
  const seenCardIds = new Set<string>();
  const ambiguousCards: AmbiguousCard[] = [];

  // 質問文には同じカードがフルネームと略称の両方で登場することがある
  // (例:「斬隠蒼頭龍バイケン」と「バイケン」)。略称側だけを見ると複数の
  // 別カードと紛らわしくても、フルネーム側で完全一致が取れているなら
  // 同一カードとみなしてよいため、先に完全一致したカードID集合を集めておく。
  const exactMatchIds = new Set(
    cardResults
      .map((matches) => matches[0])
      .filter((best): best is NonNullable<typeof best> => !!best && best.score >= EXACT_MATCH_SCORE)
      .map((best) => best.card.id),
  );

  function registerCard(match: (typeof cardResults)[number][number]): void {
    if (seenCardIds.has(match.card.id)) return;
    seenCardIds.add(match.card.id);
    cards.push({
      title: match.card.name,
      text: `文明:${match.card.civilization} 種類:${match.card.cardType} コスト:${match.card.cost} パワー:${match.card.power} 種族:${match.card.race}\n${match.card.cardText}`,
      url: match.card.url,
      sourceType: "card",
    });
    if (match.card.qaListUrl) {
      cardQaListUrls.push(match.card.qaListUrl);
    }
    // カードテキスト自体に含まれる特徴的な効果語(「無視する」等)も検索キーワードに
    // 加える。質問文には現れないが、カードの基本効果を理解する上で重要なQ&Aを
    // 拾うための補完(例: 「無視する」能力の解釈Q&A)。
    for (const concept of extractRuleConcepts(match.card.cardText)) {
      cardDerivedConcepts.add(concept);
    }
  }

  for (let i = 0; i < parsed.cardNames.length; i++) {
    const queried = parsed.cardNames[i] as string;
    const matches = cardResults[i] ?? [];

    const alreadyResolved = matches.find((m) => exactMatchIds.has(m.card.id));
    if (alreadyResolved) {
      registerCard(alreadyResolved);
      continue;
    }

    const best = matches[0];
    const rivals = matches.filter(
      (m) => m.card.id !== best?.card.id && m.score >= CARD_MATCH_MIN_SCORE,
    );
    // 完全一致以外(prefix/partial/fuzzy)で、閾値を超える別カードの候補も
    // 残っている場合は、一意に確定できたとは言えないため確認対象にする。
    // 例:「ベートーベン」→「ベートーベン・キューブ」「VAN・ベートーベン」等が並立。
    const isAmbiguous =
      !best || best.score < CARD_MATCH_MIN_SCORE || (best.score < EXACT_MATCH_SCORE && rivals.length > 0);
    if (isAmbiguous) {
      // カード名を一意に確定できなかった場合、候補があればユーザーへの確認材料として残す。
      // (裁定生成には使わず、confirmしてもらってから再質問してもらう)
      const candidates = Array.from(
        new Set(matches.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).map((m) => m.card.name)),
      );
      if (candidates.length > 0) {
        // 候補の中に環境で話題度が圧倒的に高いカードがあればWeb検索で自動確定を
        // 試みる。判断できない場合はnullが返り、従来通りユーザーへの候補確認に
        // フォールバックする(誤ったカードを勝手に確定しないための安全策)。
        const resolvedName = env.ENABLE_POPULARITY_CARD_RESOLUTION
          ? await resolvePopularCardName(queried, candidates)
          : null;
        const resolvedMatch = resolvedName
          ? matches.find((m) => m.card.name === resolvedName)
          : undefined;
        if (resolvedMatch) {
          registerCard(resolvedMatch);
          continue;
        }
        ambiguousCards.push({ queried, candidates });
      }
      continue;
    }
    registerCard(best);
  }

  const criteria = {
    cardNames: parsed.cardNames,
    ruleConcepts: Array.from(new Set([...parsed.ruleConcepts, ...cardDerivedConcepts])),
    keywords: parsed.keywords,
  };

  const [qaResults, ruleChangeResults, generalRuleResults] = await Promise.all([
    searchAndRankQa(criteria, { cardQaListUrls }),
    searchAndRankRuleChanges(criteria),
    hybridSearchGeneralRules(parsed.originalText, criteria),
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
    score: chunk.finalScore,
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

  return { cards, qa, ruleChanges, generalRules, pastCorrections, ambiguousCards };
}
