export type Correction = {
  id: number;
  originalQuestion: string;
  botConclusion: string;
  correctRuling: string;
  cardNames: string[];
  correctedBy: string; // 訂正したジャッジのjudgeId(T008以前は生セッショントークンを保存していた)
  judgeId: string; // 公認ジャッジID
  createdAt: number;
};

export type CorrectionEvidence = Correction & { score: number };
