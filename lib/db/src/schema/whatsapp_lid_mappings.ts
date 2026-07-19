import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persists the LID ↔ phone mapping across server restarts.
 * WhatsApp uses "LID" device identifiers instead of phone JIDs in newer accounts.
 * lid   : the user part of the @lid JID  e.g. "8380068413573"
 * phone : plain digits of the phone number e.g. "33612345678"
 */
export const whatsappLidMappingsTable = pgTable("whatsapp_lid_mappings", {
  lid:       text("lid").primaryKey(),
  phone:     text("phone").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WhatsappLidMapping = typeof whatsappLidMappingsTable.$inferSelect;
