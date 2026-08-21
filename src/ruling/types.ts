export type Confidence = "high" | "medium" | "low";

export type EvidenceSource = {
  title: string;
  text: string;
  url: string;
  sourceType: "card" | "qa" | "ruleChange" | "generalRule" | "correction" | "keywordAbility";
  /** 統計集計(参照回数の記録)用の安定した識別子。種別ごとに意味が異なる。 */
  itemKey: string;
};

export type ParsedQuestion = {
  originalText: string;
  cardNames: string[];
  /** 「」『』由来など、カード名かどうか確信が持てない弱い候補。見つからなくても質問全体は止めない。 */
  weakCardNames: string[];
  keywords: string[];
  ruleConcepts: string[];
  situation: string;
  question: string;
};

export type ScoredEvidenceSource = EvidenceSource & { score: number };

export type AmbiguousCard = {
  queried: string;
  candidates: string[];
};

export type RulingEvidence = {
  cards: EvidenceSource[];
  qa: ScoredEvidenceSource[];
  ruleChanges: ScoredEvidenceSource[];
  generalRules: ScoredEvidenceSource[];
  pastCorrections: ScoredEvidenceSource[];
  /** dmwiki.net(非公式のファン運営サイト)由来のキーワード能力の説明。参考情報として扱う。 */
  keywordAbilities: EvidenceSource[];
  ambiguousCards: AmbiguousCard[];
};

export type RulingSourceRef = {
  title: string;
  url: string;
};

export type RulingResult = {
  conclusion: string;
  explanation: string;
  steps: string[];
  confidence: Confidence;
  cards: string[];
  sources: RulingSourceRef[];
};
