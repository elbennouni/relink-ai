import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores Expo push tokens for each authenticated user.
 * One user can have multiple devices (iOS + Android).
 * Tokens are upserted by (userId, token) so duplicates are ignored.
 */
export const pushTokensTable = pgTable("push_tokens", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),                   // Clerk userId
  token:     text("token").notNull().unique(),            // ExponentPushToken[...]
  platform:  text("platform"),                            // "ios" | "android" | "web"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PushToken = typeof pushTokensTable.$inferSelect;
