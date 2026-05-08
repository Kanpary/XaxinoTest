import { db, eloRatingsTable, type EloRating } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { eloUpdate } from "../engine/elo";

export const DEFAULT_ELO = 1500;

function teamKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 80);
}

export async function getElo(
  leagueId: string,
  teamName: string,
): Promise<number> {
  const key = teamKey(teamName);
  const rows = await db
    .select()
    .from(eloRatingsTable)
    .where(
      and(eq(eloRatingsTable.leagueId, leagueId), eq(eloRatingsTable.teamKey, key)),
    )
    .limit(1);
  if (rows.length > 0) return rows[0]!.rating;
  // Insert default
  await db
    .insert(eloRatingsTable)
    .values({ leagueId, teamKey: key, teamName, rating: DEFAULT_ELO })
    .onConflictDoNothing();
  return DEFAULT_ELO;
}

export async function setElo(
  leagueId: string,
  teamName: string,
  rating: number,
  matchesPlayed?: number,
): Promise<void> {
  const key = teamKey(teamName);
  await db
    .insert(eloRatingsTable)
    .values({
      leagueId,
      teamKey: key,
      teamName,
      rating,
      matchesPlayed: matchesPlayed ?? 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [eloRatingsTable.leagueId, eloRatingsTable.teamKey],
      set: {
        rating,
        teamName,
        ...(matchesPlayed !== undefined ? { matchesPlayed } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function applyEloMatch(
  leagueId: string,
  homeName: string,
  awayName: string,
  homeGoals: number,
  awayGoals: number,
): Promise<{ newHome: number; newAway: number }> {
  const homeRating = await getElo(leagueId, homeName);
  const awayRating = await getElo(leagueId, awayName);
  const upd = eloUpdate({
    homeRating,
    awayRating,
    homeGoals,
    awayGoals,
    homeAdvantage: 65,
  });
  await setElo(leagueId, homeName, upd.newHomeRating);
  await setElo(leagueId, awayName, upd.newAwayRating);
  return { newHome: upd.newHomeRating, newAway: upd.newAwayRating };
}

export async function listEloByLeague(leagueId: string): Promise<EloRating[]> {
  return await db
    .select()
    .from(eloRatingsTable)
    .where(eq(eloRatingsTable.leagueId, leagueId))
    .orderBy(sql`${eloRatingsTable.rating} desc`);
}
