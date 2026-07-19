import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { relationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Verifies the authenticated user owns the relation identified by :id or :relationId.
 * Legacy relations (userId = null) are auto-claimed by the first authenticated user.
 */
export async function requireRelationOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawId = (req.params as any).id ?? (req.params as any).relationId;
  const relationId = Number(rawId);
  if (isNaN(relationId)) { next(); return; }

  const userId = (req as any).userId as string;
  if (!userId) { res.status(401).json({ error: "Non authentifié" }); return; }

  const [rel] = await db
    .select({ id: relationsTable.id, userId: relationsTable.userId })
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);

  if (!rel) { res.status(404).json({ error: "Relation introuvable" }); return; }

  // Strict ownership check: the relation must explicitly belong to this user.
  // Legacy null-userId relations are not claimable here; use POST /api/admin/claim-legacy.
  if (rel.userId !== userId) {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  next();
}
