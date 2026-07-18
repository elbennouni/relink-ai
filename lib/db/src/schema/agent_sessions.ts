import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { relationsTable } from "./relations";

export const agentSessionsTable = pgTable("agent_sessions", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().references(() => relationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AgentSession = typeof agentSessionsTable.$inferSelect;
