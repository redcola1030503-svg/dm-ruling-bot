export type QaListItem = {
  id: string;
  url: string;
  titleText: string;
  date: string;
};

export type QaDetail = {
  id: string;
  url: string;
  question: string;
  answer: string;
};

export type QaEvidence = QaDetail & {
  score: number;
};

export type RuleChangeListItem = {
  id: string;
  url: string;
  title: string;
  date: string;
};

export type RuleChangeDetail = RuleChangeListItem & {
  body: string;
};

export type RuleChangeEvidence = RuleChangeDetail & {
  score: number;
};

export type GeneralRuleChunk = {
  ruleNumber: string;
  text: string;
};

export type GeneralRuleEvidence = GeneralRuleChunk & {
  score: number;
};
