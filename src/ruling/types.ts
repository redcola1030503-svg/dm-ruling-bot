export type Confidence = "high" | "medium" | "low";

export type EvidenceSource = {
  title: string;
  text: string;
  url: string;
  sourceType: "card" | "qa" | "ruleChange" | "generalRule" | "correction";
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
