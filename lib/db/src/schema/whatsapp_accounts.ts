import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { relationsTable } from "./relations";

// Stores WhatsApp Business API credentials per relation
export const whatsappAccountsTable = pgTable("whatsapp_accounts", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().unique().references(() => relationsTable.id, { onDelete: "cascade" }),
  // Meta App credentials
  phoneNumberId: text("phone_number_id").notNull(),        // e.g. "123456789"
  accessToken: text("access_token").notNull(),              // permanent system user token
  businessAccountId: text("business_account_id"),           // WABA ID
  // The phone number of the contact (the other person in the relation)
  contactPhone: text("contact_phone"),                      // e.g. "+33612345678"
  // Webhook verify token (shared secret)
  verifyToken: text("verify_token").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WhatsappAccount = typeof whatsappAccountsTable.$inferSelect;
export type InsertWhatsappAccount = typeof whatsappAccountsTable.$inferInsert;
