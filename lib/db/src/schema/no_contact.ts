import {
  pgTable, serial, integer, text, boolean, timestamp, pgEnum,
} from "drizzle-orm/pg-core";
import { relationsTable } from "./relations";

export const noContactEventTypeEnum = pgEnum("no_contact_event_type", [
  "urge",    // envie de répondre résistée
  "panic",   // panique — a demandé l'aide IA
  "reset",   // a craqué / relance le compteur
]);

export const noContactSessionsTable = pgTable("no_contact_sessions", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().references(() => relationsTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const noContactEventsTable = pgTable("no_contact_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => noContactSessionsTable.id, { onDelete: "cascade" }),
  type: noContactEventTypeEnum("type").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type NoContactSession = typeof noContactSessionsTable.$inferSelect;
export type NoContactEvent = typeof noContactEventsTable.$inferSelect;
