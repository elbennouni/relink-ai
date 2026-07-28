/**
 * Daily background job — refreshes the power analysis for every relation
 * that has at least 20 WhatsApp messages.
 * Runs once 24 h after server start, then every 24 h.
 * Uses the same statistical logic as the POST /power-analysis SSE route
 * but without streaming — stores the result directly to DB.
 */
import { db, relationsTable, whatsappMessagesTable, powerAnalysesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function computeBasicScore(messages: { isMe: boolean; content: string; sentAt: Date }[]): number {
  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const total = sorted.length || 1;
  const meCount = sorted.filter(m => m.isMe).length;
  let score = 50;
  score -= Math.round((meCount / total - 0.5) * 20);
  // initiates
  let meInit = 0, otherInit = 0;
  const GAP = 4 * 60 * 60 * 1000;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i].sentAt.getTime() - sorted[i - 1].sentAt.getTime() > GAP) {
      if (sorted[i].isMe) meInit++; else otherInit++;
    }
  }
  const initTotal = meInit + otherInit || 1;
  score -= Math.round((meInit / initTotal - 0.5) * 15);
  return Math.max(5, Math.min(95, score));
}

async function runPowerAnalysisForRelation(relationId: number) {
  const [relation] = await db.select().from(relationsTable).where(eq(relationsTable.id, relationId)).limit(1);
  if (!relation) return;

  const messages = await db
    .select({ isMe: whatsappMessagesTable.isMe, content: whatsappMessagesTable.content, sentAt: whatsappMessagesTable.sentAt })
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.relationId, relationId))
    .orderBy(asc(whatsappMessagesTable.sentAt));

  if (messages.length < 20) return;

  const me = relation.participantMe || "Toi";
  const other = relation.participantOther || "L'autre";
  const meCount = messages.filter(m => m.isMe).length;
  const otherCount = messages.length - meCount;
  const sample = messages.slice(-60);
  const transcript = sample.map(m =>
    `${m.isMe ? me : other}: ${m.content.slice(0, 150)}`
  ).join("\n");

  const prompt = `Analyse le rapport de force entre ${me} et ${other}.
Messages: ${me} ${meCount} vs ${other} ${otherCount}
Conversation récente:\n${transcript}
Réponds UNIQUEMENT avec ce JSON:
{"score":<0-100>,"label":"<court>","trend":"<up|down|stable>","detail":"<1 phrase>"}
(score 0=other domine, 100=me domine)`;

  let meScore = computeBasicScore(messages);
  let label = meScore < 45 ? `${other} a la main` : meScore > 55 ? "Tu as la main" : "Équilibré";
  let trend: "up" | "down" | "stable" = "stable";
  let detail = "Analyse basée sur le ratio de messages.";
  let analysisText = "";

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",   // cheaper model for background job
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      meScore = Math.max(5, Math.min(95, Number(parsed.score) || meScore));
      label = parsed.label || label;
      trend = parsed.trend || trend;
      detail = parsed.detail || detail;
      analysisText = detail;
    }
  } catch { /* use fallback */ }

  await db.insert(powerAnalysesTable).values({
    relationId,
    stats: { meCount, otherCount, totalMessages: messages.length } as unknown as Record<string, unknown>,
    powerScoreMe: meScore,
    powerScoreOther: 100 - meScore,
    analysisText: analysisText || detail,
    messageCount: messages.length,
    dateRangeFrom: messages[0]?.sentAt.toISOString().slice(0, 10) ?? null,
    dateRangeTo: messages[messages.length - 1]?.sentAt.toISOString().slice(0, 10) ?? null,
  });

  console.log(`[DailyPower] relation ${relationId} — score ${meScore} (${label})`);
}

export function startDailyPowerJob() {
  const run = async () => {
    console.log("[DailyPower] Running daily power analysis for all relations…");
    try {
      const relations = await db.select({ id: relationsTable.id }).from(relationsTable);
      for (const { id } of relations) {
        try { await runPowerAnalysisForRelation(id); } catch (err) {
          console.error(`[DailyPower] failed for relation ${id}:`, err);
        }
      }
      console.log(`[DailyPower] Done — processed ${relations.length} relations`);
    } catch (err) {
      console.error("[DailyPower] Job error:", err);
    }
  };

  // Run once after a short delay on startup (to not block boot), then every 24 h
  setTimeout(() => {
    run();
    setInterval(run, MS_PER_DAY);
  }, 5 * 60 * 1000); // first run 5 min after boot
}
