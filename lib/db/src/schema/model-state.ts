import {
  pgTable,
  serial,
  real,
  integer,
  timestamp,
  text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modelStateTable = pgTable("model_state", {
  id: serial("id").primaryKey(),
  dixonColesTau: real("dixon_coles_tau").notNull().default(-0.13),
  weightedFormXi: real("weighted_form_xi").notNull().default(0.042),
  bivariateRho: real("bivariate_rho").notNull().default(0.3),
  homeAdvantage: real("home_advantage").notNull().default(0.25),
  weightDixonColes: real("weight_dixon_coles").notNull().default(0.35),
  weightBivariate: real("weight_bivariate").notNull().default(0.25),
  weightEloPoisson: real("weight_elo_poisson").notNull().default(0.25),
  weightWeightedForm: real("weight_weighted_form").notNull().default(0.15),
  lastRecalibration: timestamp("last_recalibration", { withTimezone: true }),
  lastRecalibrationNotes: text("last_recalibration_notes"),
  predictionsSinceLastCalibration: integer("predictions_since_last_calibration")
    .notNull()
    .default(0),
  totalResolvedPredictions: integer("total_resolved_predictions")
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertModelStateSchema = createInsertSchema(modelStateTable).omit({ id: true });
export type InsertModelState = z.infer<typeof insertModelStateSchema>;
export type ModelState = typeof modelStateTable.$inferSelect;
