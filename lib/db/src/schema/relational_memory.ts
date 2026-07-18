import { pgTable, serial, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relationsTable } from "./relations";

export const relationalMemoryTable = pgTable("relational_memory", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().references(() => relationsTable.id, { onDelete: "cascade" }),
  globalSummary: text("global_summary"),
  currentPhase: text("current_phase"),
  recurringTopics: jsonb("recurring_topics").$type<string[]>().notNull().default([]),
  expressedLimits: jsonb("expressed_limits").$type<string[]>().notNull().default([]),
  openQuestions: jsonb("open_questions").$type<string[]>().notNull().default([]),
  importantEvents: jsonb("important_events").$type<string[]>().notNull().default([]),
  communicationTrends: jsonb("communication_trends").$type<Record<string, string>>(),
  dynamicReport: jsonb("dynamic_report").$type<Record<string, unknown>>(),
  isBuilding: boolean("is_building").notNull().default(false),
  builtAt: timestamp("built_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type RelationalMemory = typeof relationalMemoryTable.$inferSelect;
