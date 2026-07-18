import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const relationStatusEnum = pgEnum("relation_status", ["active", "paused", "resolved"]);

export const relationsTable = pgTable("relations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  participantMe: text("participant_me").notNull(),
  participantOther: text("participant_other").notNull(),
  status: relationStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRelationSchema = createInsertSchema(relationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRelation = z.infer<typeof insertRelationSchema>;
export type Relation = typeof relationsTable.$inferSelect;
