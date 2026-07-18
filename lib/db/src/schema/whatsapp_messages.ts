import { pgTable, serial, integer, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { relationsTable } from "./relations";

export const importSourceEnum = pgEnum("import_source", ["whatsapp_file", "paste", "screenshot", "manual"]);

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().references(() => relationsTable.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
  content: text("content").notNull(),
  isMe: boolean("is_me").notNull(),
  sentAt: timestamp("sent_at").notNull(),
  importSource: importSourceEnum("import_source").notNull().default("manual"),
  contentHash: text("content_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessagesTable).omit({ id: true, createdAt: true });
export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
