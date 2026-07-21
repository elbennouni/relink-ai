import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { relationsTable } from "./relations";

export const powerAnalysesTable = pgTable("power_analyses", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().references(() => relationsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Computed statistics
  stats: jsonb("stats"), // { meCount, otherCount, meChars, otherChars, meInitiates, otherInitiates, meAvgResponseMs, otherAvgResponseMs, meDoubleTexts, otherDoubleTexts, meQuestions, otherQuestions }
  // Analysis results
  powerScoreMe: integer("power_score_me"),     // 0-100 (100 = total power)
  powerScoreOther: integer("power_score_other"),
  analysisText: text("analysis_text"),          // full AI analysis
  actionPlan: text("action_plan"),              // concrete steps
  // Metadata
  messageCount: integer("message_count"),
  dateRangeFrom: text("date_range_from"),
  dateRangeTo: text("date_range_to"),
});

export type PowerAnalysis = typeof powerAnalysesTable.$inferSelect;
