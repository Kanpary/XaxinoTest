import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const parlaysTable = pgTable("parlays", {
  id: serial("id").primaryKey(),
  parlayId: text("parlay_id").notNull().unique(),
  date: text("date").notNull(),
  label: text("label").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  legsJson: text("legs_json").notNull(),
  jointProb: real("joint_prob").notNull(),
  combinedFairOdd: real("combined_fair_odd").notNull(),
  confidenceLabel: text("confidence_label").notNull(),
  totalLegs: integer("total_legs").notNull(),

  status: text("status").notNull().default("pending"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  hitLegs: integer("hit_legs"),
  nearMissLegs: integer("near_miss_legs"),
  resultLabel: text("result_label"),
  actualResultsJson: text("actual_results_json"),
});

export const insertParlaySchema = createInsertSchema(parlaysTable).omit({ id: true });
export type InsertParlay = z.infer<typeof insertParlaySchema>;
export type Parlay = typeof parlaysTable.$inferSelect;
