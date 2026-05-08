import {
  pgTable,
  serial,
  text,
  real,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eloRatingsTable = pgTable(
  "elo_ratings",
  {
    id: serial("id").primaryKey(),
    leagueId: text("league_id").notNull(),
    teamKey: text("team_key").notNull(),
    teamName: text("team_name").notNull(),
    rating: real("rating").notNull().default(1500),
    matchesPlayed: integer("matches_played").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("elo_league_team_idx").on(t.leagueId, t.teamKey)],
);

export const insertEloRatingSchema = createInsertSchema(eloRatingsTable).omit({ id: true });
export type InsertEloRating = z.infer<typeof insertEloRatingSchema>;
export type EloRating = typeof eloRatingsTable.$inferSelect;
