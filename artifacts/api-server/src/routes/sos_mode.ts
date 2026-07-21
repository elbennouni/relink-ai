import { Router } from "express";
import { db, relationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/relations/:id/sos/status
router.get("/relations/:id/sos/status", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }
  const [relation] = await db.select({ sosMode: relationsTable.sosMode })
    .from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  res.json({ active: relation?.sosMode ?? false });
});

// POST /api/relations/:id/sos/enable
router.post("/relations/:id/sos/enable", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }
  await db.update(relationsTable).set({ sosMode: true }).where(eq(relationsTable.id, relationId));
  res.json({ active: true });
});

// POST /api/relations/:id/sos/disable
router.post("/relations/:id/sos/disable", async (req, res) => {
  const relationId = Number(req.params.id);
  if (isNaN(relationId)) { res.status(400).json({ error: "invalid id" }); return; }
  await db.update(relationsTable).set({ sosMode: false }).where(eq(relationsTable.id, relationId));
  res.json({ active: false });
});

export default router;
