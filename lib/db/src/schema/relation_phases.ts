import { pgTable, serial, integer, text, boolean, date } from "drizzle-orm/pg-core";
import { relationsTable } from "./relations";

export const relationPhasesTable = pgTable("relation_phases", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull().references(() => relationsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  description: text("description").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  isCurrentPhase: boolean("is_current_phase").notNull().default(false),
  orderIndex: integer("order_index").notNull().default(0),
});

export type RelationPhase = typeof relationPhasesTable.$inferSelect;
