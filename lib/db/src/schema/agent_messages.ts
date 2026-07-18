import { pgTable, serial, integer, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { agentSessionsTable } from "./agent_sessions";

export const agentMessageRoleEnum = pgEnum("agent_message_role", ["user", "assistant"]);

export const agentMessagesTable = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => agentSessionsTable.id, { onDelete: "cascade" }),
  role: agentMessageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  contextUsed: jsonb("context_used").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AgentMessage = typeof agentMessagesTable.$inferSelect;
