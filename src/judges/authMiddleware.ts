import type { NextFunction, Request, Response } from "express";
import { getSession } from "./repository";
import type { JudgeSession } from "./types";

const BEARER_PREFIX = "Bearer ";

function extractToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Authorization: Bearer <token> を検証し、res.locals.judgeSessionに
 * JudgeSessionを格納する。tokenはjudge_session.user_idとして扱われる
 * (モバイル用のセッション識別子。LINEのuserIdと同じ列を汎用的に流用する
 * ため、src/judges/repository.tsの変更は一切不要)。
 */
export function requireJudgeSession(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const session = token ? getSession(token) : null;
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.locals.judgeSession = session satisfies JudgeSession;
  next();
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  requireJudgeSession(req, res, () => {
    const session = res.locals.judgeSession as JudgeSession;
    if (session.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  });
}
