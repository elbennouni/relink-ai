import { Router } from "express";
import { db } from "@workspace/db";
import {
  relationalMemoryTable,
  relationPhasesTable,
  whatsappMessagesTable,
  relationsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

// GET /api/relations/:relationId/memory
router.get("/relations/:relationId/memory", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [mem] = await db
    .select()
    .from(relationalMemoryTable)
    .where(eq(relationalMemoryTable.relationId, relationId))
    .limit(1);

  if (!mem) {
    res.json({
      relationId,
      globalSummary: null,
      currentPhase: null,
      recurringTopics: [],
      expressedLimits: [],
      openQuestions: [],
      importantEvents: [],
      communicationTrends: null,
      builtAt: null,
      isBuilding: false,
    });
    return;
  }

  res.json({
    relationId: mem.relationId,
    globalSummary: mem.globalSummary,
    currentPhase: mem.currentPhase,
    recurringTopics: mem.recurringTopics,
    expressedLimits: mem.expressedLimits,
    openQuestions: mem.openQuestions,
    importantEvents: mem.importantEvents,
    communicationTrends: mem.communicationTrends,
    builtAt: mem.builtAt,
    isBuilding: mem.isBuilding,
  });
});

// POST /api/relations/:relationId/memory/build  (SSE)
router.post("/relations/:relationId/memory/build", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ step: "reading", label: "Lecture de la conversation", progress: 10 });

    const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
    if (!relation) { send({ error: "Relation introuvable" }); res.end(); return; }

    // Mark as building
    const existing = await db.select().from(relationalMemoryTable).where(eq(relationalMemoryTable.relationId, relationId)).limit(1);
    if (existing.length) {
      await db.update(relationalMemoryTable).set({ isBuilding: true }).where(eq(relationalMemoryTable.relationId, relationId));
    } else {
      await db.insert(relationalMemoryTable).values({ relationId, isBuilding: true });
    }

    const messages = await db
      .select()
      .from(whatsappMessagesTable)
      .where(eq(whatsappMessagesTable.relationId, relationId))
      .orderBy(whatsappMessagesTable.sentAt);

    send({ step: "detecting", label: "Détection des messages", progress: 25, count: messages.length });

    if (messages.length === 0) {
      send({ error: "Le contexte est insuffisant. Importez des messages d'abord." });
      await db.update(relationalMemoryTable).set({ isBuilding: false }).where(eq(relationalMemoryTable.relationId, relationId));
      res.end(); return;
    }

    send({ step: "encrypting", label: "Chiffrement", progress: 40 });

    // Build hierarchical memory — sample recent + older messages
    const recent = messages.slice(-200);
    const older = messages.slice(0, Math.min(100, messages.length - 200));
    const sample = [...older, ...recent];

    const transcript = sample
      .map(m => `[${m.sentAt.toISOString().split("T")[0]}] ${m.isMe ? relation.participantMe : relation.participantOther}: ${m.content}`)
      .join("\n");

    send({ step: "building", label: "Construction de la mémoire relationnelle", progress: 60 });

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: `Tu es un expert en psychologie de la communication. Analyse cette conversation entre ${relation.participantMe} (moi) et ${relation.participantOther} et construis une mémoire relationnelle structurée.

CONVERSATION (${messages.length} messages au total, extrait représentatif):
${transcript}

Retourne un JSON avec exactement ces champs:
{
  "globalSummary": "Résumé complet de la relation en 3-5 phrases",
  "currentPhase": "Phase actuelle de la relation (ex: Distance progressive, Rupture récente, Période de silence, etc.)",
  "recurringTopics": ["sujet 1", "sujet 2", "sujet 3"],
  "expressedLimits": ["limite exprimée 1", "limite 2"],
  "openQuestions": ["question sans réponse 1", "question 2"],
  "importantEvents": ["événement 1", "événement 2"],
  "communicationTrends": {
    "whoInitiates": "${relation.participantMe} ou ${relation.participantOther} initie le plus souvent",
    "responseBalance": "description de l'équilibre des réponses",
    "overallTone": "ton général des échanges"
  },
  "phases": [
    {
      "label": "nom de la phase",
      "description": "description",
      "startDate": "YYYY-MM-DD ou null",
      "endDate": "YYYY-MM-DD ou null",
      "isCurrentPhase": false
    }
  ],
  "dynamicReport": {
    "whoInitiates": "...",
    "whoFollowsUp": "...",
    "avgResponseTime": "...",
    "messageFrequency": "...",
    "recentChanges": "...",
    "recurringConflicts": [],
    "silences": [],
    "expressedLimits": [],
    "unansweredQuestions": [],
    "observableFacts": [],
    "trends": [],
    "hypotheses": [],
    "unknowns": []
  }
}

Retourne uniquement le JSON, sans markdown ni texte autour.`,
      }],
    });

    send({ step: "saving", label: "Enregistrement", progress: 85 });

    const block = aiResponse.content[0];
    const text = block.type === "text" ? block.text : "{}";

    let parsed: Record<string, unknown> = {};
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch { /* use empty */ }

    const now = new Date();

    await db
      .update(relationalMemoryTable)
      .set({
        globalSummary: parsed.globalSummary as string || null,
        currentPhase: parsed.currentPhase as string || null,
        recurringTopics: (parsed.recurringTopics as string[]) || [],
        expressedLimits: (parsed.expressedLimits as string[]) || [],
        openQuestions: (parsed.openQuestions as string[]) || [],
        importantEvents: (parsed.importantEvents as string[]) || [],
        communicationTrends: (parsed.communicationTrends as Record<string, string>) || null,
        dynamicReport: (parsed.dynamicReport as Record<string, unknown>) || null,
        isBuilding: false,
        builtAt: now,
        updatedAt: now,
      })
      .where(eq(relationalMemoryTable.relationId, relationId));

    // Upsert phases
    if (Array.isArray(parsed.phases)) {
      await db.delete(relationPhasesTable).where(eq(relationPhasesTable.relationId, relationId));
      const phases = parsed.phases as Array<{
        label: string; description: string; startDate?: string; endDate?: string; isCurrentPhase?: boolean;
      }>;
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        await db.insert(relationPhasesTable).values({
          relationId,
          label: p.label || "Phase",
          description: p.description || "",
          startDate: p.startDate || null,
          endDate: p.endDate || null,
          isCurrentPhase: p.isCurrentPhase ?? false,
          orderIndex: i,
        });
      }
    }

    send({ step: "done", label: "Mémoire relationnelle prête", progress: 100 });
    res.end();
  } catch (err) {
    send({ error: "L'analyse est temporairement indisponible." });
    await db.update(relationalMemoryTable).set({ isBuilding: false }).where(eq(relationalMemoryTable.relationId, relationId)).catch(() => {});
    res.end();
  }
});

// GET /api/relations/:relationId/memory/phases
router.get("/relations/:relationId/memory/phases", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const phases = await db
    .select()
    .from(relationPhasesTable)
    .where(eq(relationPhasesTable.relationId, relationId))
    .orderBy(relationPhasesTable.orderIndex);

  res.json(phases.map(p => ({
    id: p.id,
    label: p.label,
    description: p.description,
    startDate: p.startDate,
    endDate: p.endDate,
    isCurrentPhase: p.isCurrentPhase,
  })));
});

// GET /api/relations/:relationId/memory/report
router.get("/relations/:relationId/memory/report", async (req, res) => {
  const relationId = Number(req.params.relationId);
  if (isNaN(relationId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [mem] = await db.select().from(relationalMemoryTable).where(eq(relationalMemoryTable.relationId, relationId)).limit(1);

  if (!mem?.dynamicReport) {
    res.json({
      whoInitiates: null, whoFollowsUp: null, avgResponseTime: null,
      messageFrequency: null, recentChanges: null,
      recurringConflicts: [], silences: [], expressedLimits: [],
      unansweredQuestions: [], observableFacts: [], trends: [], hypotheses: [], unknowns: [],
    });
    return;
  }

  const r = mem.dynamicReport as Record<string, unknown>;
  res.json({
    whoInitiates: r.whoInitiates ?? null,
    whoFollowsUp: r.whoFollowsUp ?? null,
    avgResponseTime: r.avgResponseTime ?? null,
    messageFrequency: r.messageFrequency ?? null,
    recentChanges: r.recentChanges ?? null,
    recurringConflicts: r.recurringConflicts ?? [],
    silences: r.silences ?? [],
    expressedLimits: r.expressedLimits ?? [],
    unansweredQuestions: r.unansweredQuestions ?? [],
    observableFacts: r.observableFacts ?? [],
    trends: r.trends ?? [],
    hypotheses: r.hypotheses ?? [],
    unknowns: r.unknowns ?? [],
  });
});

export default router;
