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

    send({ step: "encrypting", label: "Chiffrement sécurisé", progress: 35 });

    // ── Compression helpers ────────────────────────────────────────────────────
    const me = relation.participantMe;
    const other = relation.participantOther;
    // Compact format: "Me: text" or "Eux: text" with optional date markers
    function compressChunk(
      msgs: typeof messages,
      withDates = false
    ): string {
      let out = "";
      let lastDate = "";
      for (const m of msgs) {
        const date = m.sentAt.toISOString().split("T")[0];
        if (withDates && date !== lastDate) {
          out += `\n── ${date} ──\n`;
          lastDate = date;
        }
        out += `${m.isMe ? "Moi" : other}: ${m.content}\n`;
      }
      return out.trim();
    }

    // ── Strategy: send ALL if ≤ 8 000 messages, else chunk-summarise ──────────
    const DIRECT_LIMIT = 8000;
    const CHUNK_SIZE   = 2000;

    let conversationContext: string;

    if (messages.length <= DIRECT_LIMIT) {
      // ── DIRECT: full conversation compressed ────────────────────────────────
      send({ step: "building", label: `Lecture intégrale — ${messages.length} messages`, progress: 55 });
      conversationContext = `CONVERSATION COMPLÈTE (${messages.length} messages) :\n${compressChunk(messages, true)}`;

    } else {
      // ── CHUNKED: summarise each slice, then synthesise ───────────────────────
      const chunks: typeof messages[] = [];
      for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        chunks.push(messages.slice(i, i + CHUNK_SIZE));
      }

      const chunkSummaries: string[] = [];

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const pct = Math.round(40 + (ci / chunks.length) * 35);
        const firstDate = chunk[0].sentAt.toISOString().split("T")[0];
        const lastDate  = chunk[chunk.length - 1].sentAt.toISOString().split("T")[0];
        send({
          step: "building",
          label: `Analyse tranche ${ci + 1}/${chunks.length} (${firstDate} → ${lastDate})`,
          progress: pct,
        });

        const chunkText = compressChunk(chunk, true);
        const summaryResp = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: `Résume cette tranche de conversation entre ${me} (Moi) et ${other} en 3-6 phrases.
Couvre : qui initie, qui poursuit, le ton général, les tensions, événements importants, et tout changement de dynamique de pouvoir.
Sois factuel et précis. Pas de conclusion générale — juste ce qui se passe dans CETTE tranche.

TRANCHE (${firstDate} → ${lastDate}) :
${chunkText}

Résumé :`,
          }],
        });

        const summaryBlock = summaryResp.content[0];
        const summary = summaryBlock.type === "text" ? summaryBlock.text.trim() : "";
        chunkSummaries.push(`[${firstDate} → ${lastDate}] ${summary}`);
      }

      // Last 300 messages verbatim for recency detail
      const recent300 = compressChunk(messages.slice(-300), true);
      conversationContext = `RÉSUMÉS PAR PÉRIODE (${messages.length} messages au total, ${chunks.length} tranches) :
${chunkSummaries.join("\n\n")}

DERNIERS 300 MESSAGES VERBATIM (le plus récent) :
${recent300}`;

      send({ step: "building", label: "Synthèse finale de toute la conversation", progress: 78 });
    }

    send({ step: "building", label: "Analyse des dynamiques de pouvoir", progress: 82 });

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: `Tu es un expert en psychologie relationnelle et en dynamiques de pouvoir dans les relations amoureuses. Analyse cette conversation entre ${me} (MOI — l'utilisateur de l'application) et ${other} et construis une mémoire relationnelle structurée avec une analyse approfondie des dynamiques de pouvoir.

CONVENTION IMPORTANTE: "${me}" = MOI (l'utilisateur qui cherche de l'aide). "${other}" = L'AUTRE personne.

${conversationContext}

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
    "imbalanceDirection": "vers ${other} ou équilibré ou vers ${me}",
    "dominancePatterns": [
      "Pattern précis 1: ex '${other} laisse souvent ${me} sans réponse pendant X heures puis répond froidement'",
      "Pattern précis 2",
      "Pattern précis 3"
    ],
    "submissivePatterns": [
      "Pattern précis 1: ex '${me} envoie plusieurs messages sans réponse, s'excuse en premier'",
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
      "Moment où le rapport de force a basculé, ex: 'Après l'événement X, ${me} a commencé à poursuivre plus'"
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
- -10 = ${other} a un contrôle total, ${me} est complètement en position de faiblesse
- 0 = relation équilibrée
- +10 = ${me} a le contrôle total

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
