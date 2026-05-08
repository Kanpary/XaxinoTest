/**
 * Live games service — polls all active ESPN leagues and returns fixtures
 * currently in the "in" (in-progress) state.
 *
 * To avoid hammering ESPN with 64 sequential requests, we fan-out in batches
 * of 8 concurrent requests with a per-league 6-second timeout.
 */

import { LEAGUES } from "../data-sources/leagues";
import { fetchScoreboard } from "../data-sources/espn";
import { logger } from "../lib/logger";

export interface LiveGame {
  fixtureId: string;
  leagueId: string;
  leagueName: string;
  espnSlug: string;
  homeTeam: string;
  awayTeam: string;
  liveMinute: string;
  liveHomeScore: number;
  liveAwayScore: number;
  statusDetail: string;
}

function todayAndYesterdayYYYYMMDD(): string[] {
  const now = new Date();
  const brt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = brt.format(now).replace(/-/g, "");
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = brt.format(yesterday).replace(/-/g, "");
  return [today, yesterdayStr];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}

async function checkLeagueForLiveGames(
  league: (typeof LEAGUES)[0],
  dates: string[],
): Promise<LiveGame[]> {
  const seen = new Set<string>();
  const results: LiveGame[] = [];

  for (const date of dates) {
    try {
      const events = await withTimeout(fetchScoreboard(league.espnSlug, date), 6_000);
      for (const ev of events) {
        if (ev.status.type.state !== "in") continue;
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);

        const comp = ev.competitions?.[0];
        if (!comp) continue;

        const home = comp.competitors.find((c) => c.homeAway === "home");
        const away = comp.competitors.find((c) => c.homeAway === "away");
        if (!home || !away) continue;

        const liveHomeScore = parseInt(home.score ?? "0", 10);
        const liveAwayScore = parseInt(away.score ?? "0", 10);

        const minuteDisplay =
          ev.status.type.shortDetail && ev.status.type.shortDetail !== ""
            ? ev.status.type.shortDetail
            : ev.status.displayClock ?? "?'";

        results.push({
          fixtureId: ev.id,
          leagueId: league.id,
          leagueName: league.name,
          espnSlug: league.espnSlug,
          homeTeam: home.team.displayName,
          awayTeam: away.team.displayName,
          liveMinute: minuteDisplay,
          liveHomeScore: isNaN(liveHomeScore) ? 0 : liveHomeScore,
          liveAwayScore: isNaN(liveAwayScore) ? 0 : liveAwayScore,
          statusDetail: ev.status.type.shortDetail ?? "Ao vivo",
        });
      }
    } catch (err) {
      logger.warn({ err, leagueId: league.id, date }, "Live-games fetch error for league");
    }
  }

  return results;
}

async function runBatch(
  leagues: (typeof LEAGUES)[0][],
  dates: string[],
): Promise<LiveGame[]> {
  const settled = await Promise.allSettled(
    leagues.map((l) => checkLeagueForLiveGames(l, dates)),
  );
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

export async function getLiveGames(): Promise<LiveGame[]> {
  const active = LEAGUES.filter((l) => l.active);
  const dates = todayAndYesterdayYYYYMMDD();

  const BATCH = 8;
  const all: LiveGame[] = [];

  for (let i = 0; i < active.length; i += BATCH) {
    const batch = active.slice(i, i + BATCH);
    const chunk = await runBatch(batch, dates);
    all.push(...chunk);
  }

  logger.info({ count: all.length }, "Live games fetched");
  return all;
}
