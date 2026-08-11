export type JudgeRole = "judge" | "admin";

export type Judge = {
  id: string;
  role: JudgeRole;
  createdAt: number;
  createdBy: string;
};

export type JudgeSession = {
  userId: string;
  judgeId: string;
  loggedInAt: number;
  role: JudgeRole;
};
