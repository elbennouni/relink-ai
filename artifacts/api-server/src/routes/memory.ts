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
        content: `Tu es un expert en psychologie relationnelle et en dynamiques de pouvoir dans les relations amoureuses. Analyse cette conversation entre ${relation.participantMe} (MOI — l'utilisateur de l'application) et ${relation.participantOther} et construis une mémoire relationnelle structurée avec une analyse approfondie des dynamiques de pouvoir.

CONVENTION IMPORTANTE: "${relation.participantMe}" = MOI (l'utilisateur qui cherche de l'aide). "${relation.participantOther}" = L'AUTRE personne.

CONVERSATION (${messages.length} messages au total, extrait représentatif):
${transcript}

Analyse avec précision:
1. QUI INITIE le plus souvent les conversations, les réconciliations, les sujets
2. QUI POURSUIT (relance, double-texte, reste sans réponse)
3. QUI CONCÈDE, s'adapte, s'excuse en premier
4. QUI IGNORE, lit sans répondre, répond froid ou laconique
5. QUI POSE DES CONDITIONS ou ultimatums
6. L'ÉVOLUTION de ces dynamiques dans le temps (est-ce que ça empire ?)
7. Les TENSIONS récurrentes et leurs déclencheurs
8. Les moments où le rapport de force a basculé

Retourne un JSON avec exactement ces champs:
{
  "globalSummary": "Résumé complet de la relation en 3-5 phrases incluant la dynamique de pouvoir principale",
  "currentPhase": "Phase actuelle de la relation (ex: Distance progressive, Rupture récente, Période de silence, Attente unilatérale, etc.)",
  "recurringTopics": ["sujet 1", "sujet 2", "sujet 3"],
  "expressedLimits": ["limite exprimée 1", "limite 2"],
  "openQuestions": ["question sans réponse 1", "question 2"],
  "importantEvents": ["événement clé 1 avec date approximative", "événement 2"],
  "communicationTrends": {
    "whoInitiates": "qui initie le plus souvent et à quelle fréquence",
    "responseBalance": "description précise de l'équilibre des réponses — délais, longueur, chaleur",
    "overallTone": "ton général des échanges"
  },
  "powerDynamics": {
    "dominantPerson": "Nom de la personne qui a le plus de pouvoir/contrôle dans la relation actuellement",
    "submissivePerson": "Nom de la personne qui s'adapte, concède, poursuit",
    "imbalanceScore": 0,
    "imbalanceDirection": "vers ${relation.participantOther} ou équilibré ou vers ${relation.participantMe}",
    "dominancePatterns": [
      "Pattern précis 1: ex '${relation.participantOther} laisse souvent ${relation.participantMe} sans réponse pendant X heures puis répond froidement'",
      "Pattern précis 2",
      "Pattern précis 3"
    ],
    "submissivePatterns": [
      "Pattern précis 1: ex '${relation.participantMe} envoie plusieurs messages sans réponse, s'excuse en premier'",
      "Pattern précis 2"
    ],
    "tensionPoints": [
      {
        "trigger": "déclencheur de la tension",
        "pattern": "ce qui se passe systématiquement",
        "whoEscalates": "qui monte le ton",
        "whoDeescalates": "qui tente de calmer",
        "resolution": "comment ça se résout généralement"
      }
    ],
    "powerShifts": [
      "Moment où le rapport de force a basculé, ex: 'Après l'événement X, ${relation.participantMe} a commencé à poursuivre plus'"
    ],
    "currentDynamicSummary": "Paragraphe de 2-3 phrases décrivant la dynamique actuelle de façon directe et honnête",
    "reversalStrategy": {
      "mainPrinciple": "Principe clé pour rééquilibrer le rapport de force",
      "immediateActions": [
        "Action concrète à faire maintenant (ex: arrêter de double-texter)",
        "Action 2",
        "Action 3"
      ],
      "behaviorsToStop": [
        "Comportement à arrêter immédiatement",
        "Comportement 2"
      ],
      "behaviorsToAdopt": [
        "Nouveau comportement à adopter",
        "Comportement 2"
      ],
      "messagingPrinciples": [
        "Principe sur comment rédiger les messages pour rééquilibrer",
        "Principe 2"
      ]
    }
  },
  "phases": [
    {
      "label": "nom de la phase",
      "description": "description incluant qui avait le pouvoir pendant cette phase",
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

IMPORTANT: Pour imbalanceScore, utilise une échelle de -10 à +10:
- -10 = ${relation.participantOther} a un contrôle total, ${relation.participantMe} est complètement en position de faiblesse
- 0 = relation équilibrée
- +10 = ${relation.participantMe} a le contrôle total

Sois direct et honnête dans l'analyse, même si c'est inconfortable. L'utilisateur a besoin de voir la réalité pour agir.
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

    // Merge powerDynamics into dynamicReport for storage (single jsonb column)
    const dynamicReport = {
      ...((parsed.dynamicReport as Record<string, unknown>) || {}),
      powerDynamics: parsed.powerDynamics || null,
    };

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
        dynamicReport,
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
