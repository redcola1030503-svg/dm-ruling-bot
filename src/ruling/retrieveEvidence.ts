import { findCardCandidates } from "../cards/cardNameMatcher";
import { env } from "../config/env";
import { searchAndRankRuleChanges } from "../rules/ruleChangeRanking";
import { extractRuleConcepts } from "../rules/ruleConceptDictionary";
import { getKeywordAbilitiesByNames } from "../rules/keywordAbilityRepository";
import { searchVerifiedRulingPrinciples } from "../rules/verifiedRulingPrinciples";
import { searchAndRankCorrections } from "../corrections/ranking";
import { hybridSearchGeneralRules, hybridSearchQa } from "../search/hybridSearch";
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
// dmwiki説明文は非公式の補助情報(generateRuling.tsのルール21で断定根拠にはできないと明記済み)
// のため、長文カード(例:「侵略」3,333文字)がClaudeへの入力トークンを不必要に押し上げないよう、
// 冒頭の定義部分のみに切り詰めて渡す。DB上のkeyword_ability.descriptionは全文のまま保持する
// (URLで元ページを参照できるため、切り詰めても情報は失われない)。
const KEYWORD_ABILITY_MAX_LENGTH = 1200;

function truncateKeywordAbilityText(text: string): string {
  if (text.length <= KEYWORD_ABILITY_MAX_LENGTH) return text;
  const cutAt = text.lastIndexOf("\n", KEYWORD_ABILITY_MAX_LENGTH);
  const truncated = cutAt > 0 ? text.slice(0, cutAt) : text.slice(0, KEYWORD_ABILITY_MAX_LENGTH);
  return `${truncated}\n…(以下省略。詳細は元ページのURLを参照)`;
}

export async function retrieveEvidence(parsed: ParsedQuestion): Promise<RulingEvidence> {
  const cardResults = await Promise.all(
    parsed.cardNames.map((name) => findCardCandidates(name, { maxResults: 5 })),
  );
  const weakCardResults = await Promise.all(
    parsed.weakCardNames.map((name) => findCardCandidates(name, { maxResults: 5 })),
  );

  const cards: EvidenceSource[] = [];
  const cardQaListUrls: string[] = [];
  const cardDerivedConcepts = new Set<string>();
  const seenCardIds = new Set<string>();
  const ambiguousCards: AmbiguousCard[] = [];
  const resolvedWeakCardNames: string[] = [];

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
      itemKey: match.card.id,
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
        ambiguousCards.push({ queried, candidates });
      }
      continue;
    }
    registerCard(best);
  }

  // 「」『』由来の弱い候補: 一般名詞や能力名(「侵略」「猫」等)である可能性が高いため、
  // 見つかった場合のみカード情報として採用する。見つからなくても、strongな候補と違って
  // ambiguousCardsには入れない(=質問全体をカード名未確定扱いで止めない)。
  for (let i = 0; i < parsed.weakCardNames.length; i++) {
    const queried = parsed.weakCardNames[i] as string;
    const matches = weakCardResults[i] ?? [];
    const best = matches[0];
    if (best && best.score >= CARD_MATCH_MIN_SCORE) {
      registerCard(best);
      resolvedWeakCardNames.push(queried);
    }
  }

  const criteria = {
    cardNames: [...parsed.cardNames, ...resolvedWeakCardNames],
    ruleConcepts: Array.from(new Set([...parsed.ruleConcepts, ...cardDerivedConcepts])),
    keywords: parsed.keywords,
  };

  const [qaResults, ruleChangeResults, generalRuleResults] = await Promise.all([
    hybridSearchQa(parsed.originalText, criteria, { cardQaListUrls }),
    searchAndRankRuleChanges(criteria),
    hybridSearchGeneralRules(parsed.originalText, criteria),
  ]);

  const qa: ScoredEvidenceSource[] = qaResults.map((item) => ({
    title: item.question.slice(0, 60),
    text: `Q: ${item.question}\nA: ${item.answer}`,
    url: item.url,
    sourceType: "qa",
    itemKey: item.url,
    score: item.score,
  }));

  const ruleChanges: ScoredEvidenceSource[] = ruleChangeResults.map((item) => ({
    title: item.title,
    text: item.body,
    url: item.url,
    sourceType: "ruleChange",
    itemKey: item.url,
    score: item.score,
  }));

  const generalRules: ScoredEvidenceSource[] = generalRuleResults.map((chunk) => ({
    title: `総合ルール ${chunk.ruleNumber}`,
    text: chunk.text,
    url: env.DM_GENERAL_RULE_PAGE_URL,
    sourceType: "generalRule",
    itemKey: chunk.ruleNumber,
    score: chunk.finalScore,
  }));

  // 公認ジャッジ本人がこのBotの誤りを実際に指摘・修正した記録。公式総合ルール・
  // 公式Q&Aと同等に信頼できる一次資料として扱う(generateRuling側の指示書参照)。
  // Webページを持たないためurlは空文字のままだが、sourcesには含められる
  // (generateRuling側でタイトル一致による照合を行う)。
  const correctionResults = searchAndRankCorrections(criteria);
  const pastCorrections: ScoredEvidenceSource[] = correctionResults.map((correction) => ({
    title: `過去の訂正事例(ジャッジID: ${correction.judgeId})`,
    text: `質問: ${correction.originalQuestion}\nBotの誤った結論: ${correction.botConclusion}\n正しい裁定: ${correction.correctRuling}`,
    url: "",
    sourceType: "correction",
    itemKey: String(correction.id),
    score: correction.score,
  }));

  // dmwiki.net(非公式のファン運営サイト)由来のキーワード能力の説明。総合ルールブック
  // には侵略等の個別キーワード能力の定義が含まれていないため補助的に参照するが、
  // 非公式情報であることをgenerateRuling側のプロンプトで明示的に注意喚起する。
  const keywordAbilityResults = getKeywordAbilitiesByNames(criteria.ruleConcepts);
  const keywordAbilities: EvidenceSource[] = keywordAbilityResults.map((ability) => ({
    title: ability.name,
    text: truncateKeywordAbilityText(ability.description),
    url: ability.url,
    sourceType: "keywordAbility",
    itemKey: ability.name,
  }));

  // D-006: 出典・適用条件を持つ検証済み裁定原則。ルール概念・キーワードが一致する
  // 質問にのみ取得され、常時ハードコードの個別裁定を段階的に置き換える。
  // criteria.ruleConceptsではなくparsed.ruleConceptsを使う(質問文由来のみ)。
  // cardDerivedConcepts(関連カードのテキストから抽出した概念語)まで含めると、
  // 質問の論点と無関係でも「そのカードがブレイカー能力を持つ」というだけで
  // 原則が注入されてしまい、hasAnyEvidence判定やconfidenceにも意図せず影響する。
  const verifiedRulingPrincipleResults = searchVerifiedRulingPrinciples({
    ruleConcepts: parsed.ruleConcepts,
    keywords: parsed.keywords,
  });
  const verifiedRulingPrinciples: EvidenceSource[] = verifiedRulingPrincipleResults.map((principle) => {
    const verificationLabel =
      principle.verification === "official_rule" ? "公式総合ルール条文に基づく" : "公認ジャッジによる確認済み";
    return {
      title: principle.title,
      text: [
        principle.ruling,
        `適用条件: ${principle.appliesWhen.join("／")}`,
        `適用しない条件: ${principle.doesNotApplyWhen.join("／")}`,
        principle.officialRuleIds.length > 0
          ? `根拠となる公式総合ルール: ${principle.officialRuleIds.join(", ")}`
          : "",
        principle.officialQaUrls.length > 0 ? `根拠となる公式Q&A: ${principle.officialQaUrls.join(", ")}` : "",
        `検証区分: ${verificationLabel}(確認日: ${principle.verifiedAt})`,
      ]
        .filter(Boolean)
        .join("\n"),
      // officialQaUrlsを持つ原則は代表として1件目をurlに設定し、既存のURL捏造防止
      // チェック(sources検証)に自然に乗せる。無い場合はpastCorrections同様url=""とする。
      url: principle.officialQaUrls[0] ?? "",
      sourceType: "verifiedRulingPrinciple",
      itemKey: principle.id,
    };
  });

  return {
    cards,
    qa,
    ruleChanges,
    generalRules,
    pastCorrections,
    keywordAbilities,
    verifiedRulingPrinciples,
    ambiguousCards,
  };
}
