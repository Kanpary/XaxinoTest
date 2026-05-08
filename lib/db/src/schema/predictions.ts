import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  real,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const predictionsTable = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),
    fixtureId: text("fixture_id").notNull(),
    leagueId: text("league_id").notNull(),
    leagueName: text("league_name").notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }).notNull(),
    matchDate: text("match_date"),

    primaryHome: integer("primary_home").notNull(),
    primaryAway: integer("primary_away").notNull(),
    primaryProb: real("primary_prob").notNull(),
    pred2Home: integer("pred2_home"),
    pred2Away: integer("pred2_away"),
    pred2Prob: real("pred2_prob"),
    pred3Home: integer("pred3_home"),
    pred3Away: integer("pred3_away"),
    pred3Prob: real("pred3_prob"),
    hedgeScoresJson: text("hedge_scores_json"),
    topNScoresJson: text("top_n_scores_json"),

    assertivenessReal: real("assertiveness_real").notNull().default(0),
    ensembleConvergence: real("ensemble_convergence").notNull().default(0),
    currentOdd: real("current_odd"),
    fairValue: real("fair_value"),
    edgePct: real("edge_pct"),
    zScore: real("z_score").notNull().default(0),
    verdict: text("verdict").notNull().default("INCONCLUSIVE"),
    forensicVerdict: text("forensic_verdict"),
    motorsActivated: text("motors_activated"),
    xrayDriver: text("xray_driver"),

    status: text("status").notNull().default("pending"),

    actualHome: integer("actual_home"),
    actualAway: integer("actual_away"),
    hitExact: boolean("hit_exact"),
    hitExact2: boolean("hit_exact2"),
    hitExact3: boolean("hit_exact3"),
    hitAnyExact: boolean("hit_any_exact"),
    hitWithinOne: boolean("hit_within_one"),

    isLive: boolean("is_live").notNull().default(false),
    liveMinute: integer("live_minute"),
    liveHomeScore: integer("live_home_score"),
    liveAwayScore: integer("live_away_score"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("predictions_fixture_id_idx").on(t.fixtureId)],
);

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({ id: true, createdAt: true });
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
