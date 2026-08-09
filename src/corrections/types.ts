export type Correction = {
  id: number;
  originalQuestion: string;
  botConclusion: string;
  correctRuling: string;
  cardNames: string[];
  correctedBy: string; // LINEユーザーID
  judgeId: string; // 公認ジャッジID
  createdAt: number;
};

export type CorrectionEvidence = Correction & { score: number };
