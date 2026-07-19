import { getAuth } from "@clerk/express";
import { Request, Response, NextFunction } from "express";

/** Verifies the Clerk session and attaches userId to req. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  (req as any).userId = userId;
  next();
}
