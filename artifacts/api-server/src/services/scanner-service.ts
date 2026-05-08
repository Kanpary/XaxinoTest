/**
 * Scanner orchestration: per league + date, fetches fixtures, builds inputs,
 * fetches bookmaker odds (for model blend + display), runs the engine,
 * and persists predictions.
 *
 * Odds are fetched IN PARALLEL with team schedules so they are available
 * as input to scanFixture — the Market Blend module uses them inside the
 * engine BEFORE Monte Carlo runs, improving prediction accuracy.
 */

import {
  fetchScoreboard,
  fetchFixturesForDate,
  fetchTeamScheduleMultiSeason,
  extractPastResults,
  fetchLiveMatchStats,
  type EspnFixture,
  type PastResult,
} from "../data-sources/espn";
import { fetchWeather } from "../data-sources/weather";
import {
  LEAGUES,
  type LeagueDef,
  findLeague,
} from "../data-sources/leagues";
import { scanFixture, type NeuralXReportOut, type ScannerThresholds } from "../engine/scanner";
import { getModelState } from "./model-state-service";
import { getElo, applyEloMatch } from "./elo-service";
import { upsertPrediction } from "./prediction-service";
import { fetchBettingMarkets, clearOddsCache } from "../data-sources/odds";
import { logger } from "../lib/logger";
import type { PastMatch } from "../engine/weighted-form";

export interface ScannerRunOptions {
  leagueIds?: string[];
  date?: string; // YYYY-MM-DD
  minEdge?: number;
  minConvergence?: number;
}

export interface ScannerRunResult {
  scannedAt: string;
  date: string;
  fixturesScanned: number;
  singularitiesFound: number;
  inconclusiveCount: number;
  thresholds: ScannerThresholds;
  reports: NeuralXReportOut[];
}

function todayBrasilia(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function isoToYYYYMMDD(iso: string): string {
  return iso.replace(/-/g, "");
}

function daysAgo(date: string, ref: Date): number {
  const t = +new Date(date);
  return Math.max(0, Math.floor((+ref - t) / (1000 * 60 * 60 * 24)));
}

function pastResultsToMatches(results: PastResult[], ref: Date): PastMatch[] {
  // 20 matches gives better form/venue-split estimates with 3-season data now available.
  // The exponential decay already discounts older games appropriately.
  return results
    .map((r) => ({
      daysAgo: daysAgo(r.date, ref),
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      isHome: r.isHome,
    }))
    .slice(0, 20);
}

/**
 * Build H2H sample by cross-referencing BOTH team schedules.
 *
 * Strategy:
 *  A) From homeResults: find matches where opponentId === awayTeamId.
 *     Scores are already in home-team perspective (goalsFor = home goals).
 *  B) From awayResults: find matches where opponentId === homeTeamId.
 *     Scores are in AWAY-team perspective — flip them to get home perspective.
 *  C) Merge A+B and deduplicate by date (within 48h window).
 *  D) Sort by most recent, limit to 10 confrontos.
 *
 * This doubles the H2H coverage vs looking at one schedule only, and also
 * catches H2H matches from previous seasons (since we now fetch multi-season).
 */
/**
 * Match a PastResult against a team.
 *
 * Primary: opponentId string equality (ESPN numeric team ID).
 * Fallback: case-insensitive display name contains the target name.
 * This handles cases where the schedule API returns competitors with a
 * lazy `$ref`-only `team` object (no `id` field populated).
 */
function matchesTeam(r: PastResult, teamId: string, teamName: string): boolean {
  if (r.opponentId && r.opponentId === teamId) return true;
  if (!r.opponentId && r.opponent) {
    const rName = r.opponent.toLowerCase().replace(/[^a-z0-9]/g, "");
    const tName = teamName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (rName.length >= 3 && tName.length >= 3) {
      return rName.includes(tName.slice(0, 5)) || tName.includes(rName.slice(0, 5));
    }
  }
  return false;
}

function findH2H(
  homeResults: PastResult[],
  homeTeamId: string,
  homeTeamName: string,
  awayResults: PastResult[],
  awayTeamId: string,
  awayTeamName: string,
  ref: Date,
): PastMatch[] {
  // Perspective A: from home team's schedule
  const fromHome = homeResults
    .filter((r) => matchesTeam(r, awayTeamId, awayTeamName))
    .map((r) => ({
      date: r.date,
      daysAgo: daysAgo(r.date, ref),
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      isHome: r.isHome,
    }));

  // Perspective B: from away team's schedule — flip scores to home perspective
  const fromAway = awayResults
    .filter((r) => matchesTeam(r, homeTeamId, homeTeamName))
    .map((r) => ({
      date: r.date,
      daysAgo: daysAgo(r.date, ref),
      goalsFor: r.goalsAgainst,  // away's goals-against = home team's goals
      goalsAgainst: r.goalsFor,  // away's goals-for = home team's goals-against
      isHome: !r.isHome,         // from home team's perspective
    }));

  // Merge + deduplicate: two records are the same game if dates are within 48h
  const merged = [...fromHome];
  for (const candidate of fromAway) {
    const tA = new Date(candidate.date).getTime();
    const isDuplicate = merged.some(
      (existing) => Math.abs(new Date(existing.date).getTime() - tA) < 48 * 3600 * 1000,
    );
    if (!isDuplicate) merged.push(candidate);
  }

  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return merged.slice(0, 12).map(({ daysAgo: da, goalsFor, goalsAgainst, isHome }) => ({
    daysAgo: da,
    goalsFor,
    goalsAgainst,
    isHome,
  }));
}

async function bootstrapEloFromHistory(
  league: LeagueDef,
  homeName: string,
  awayName: string,
  homeResults: PastResult[],
  awayResults: PastResult[],
): Promise<void> {
  // Use more history (12 games per team instead of 6) now that we have 3 seasons.
  // This gives Elo ratings a much stronger prior, especially for newly promoted teams.
  const recent = [
    ...homeResults.slice(0, 12).map((r) => ({ team: homeName, r })),
    ...awayResults.slice(0, 12).map((r) => ({ team: awayName, r })),
  ];
  recent.sort((a, b) => +new Date(a.r.date) - +new Date(b.r.date));
  for (const { team, r } of recent) {
    const opp = r.opponent;
    if (!opp) continue;
    if (r.isHome) {
      await applyEloMatch(league.id, team, opp, r.goalsFor, r.goalsAgainst);
    } else {
      await applyEloMatch(league.id, opp, team, r.goalsAgainst, r.goalsFor);
    }
  }
}

export async function runScanner(
  options: ScannerRunOptions,
): Promise<ScannerRunResult> {
  const dateBR = options.date ?? todayBrasilia();
  const dateYYYYMMDD = isoToYYYYMMDD(dateBR);

  const targetLeagues: LeagueDef[] = (options.leagueIds && options.leagueIds.length > 0
    ? options.leagueIds
        .map((id) => findLeague(id))
        .filter((l): l is LeagueDef => Boolean(l))
    : LEAGUES.filter((l) => l.active));

  const minEdge = options.minEdge ?? 0;
  const minConvergence = options.minConvergence ?? 0.6;
  const thresholds: ScannerThresholds = {
    minEdge,
    minConvergence,
    minAssertiveness: 0.06,
  };

  const modelState = await getModelState();
  const reports: NeuralXReportOut[] = [];
  const refDate = new Date(`${dateBR}T12:00:00Z`);

  // Clear odds day-cache at start of scanner run
  clearOddsCache();

  let totalFixtures = 0;

  // Formatter used to convert any UTC date to its BRT (UTC-3) calendar date.
  const brtFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Determine whether the requested date is in the past (end-of-day BRT).
  // ESPN's scoreboard endpoint returns 0 events for past dates; we need
  // the team-schedule fallback in that case.
  const endOfDayBRT = new Date(`${dateBR}T23:59:59-03:00`);
  const isPastDate = endOfDayBRT < new Date();

  for (const league of targetLeagues) {
    let events: EspnFixture[] = [];
    try {
      events = await fetchScoreboard(league.espnSlug, dateYYYYMMDD);
    } catch (err) {
      logger.warn({ err, league: league.id }, "Failed to fetch scoreboard");
      continue;
    }

    // ESPN returns dates in UTC. Filter to only events whose kickoff,
    // when converted to BRT (America/Sao_Paulo), falls on the requested date.
    // This prevents adjacent-day leakage caused by UTC vs BRT timezone shifts.
    events = events.filter((ev) => {
      const parsed = new Date(ev.date);
      if (Number.isNaN(parsed.getTime())) return false;
      return brtFmt.format(parsed) === dateBR;
    });

    // ── Past-date fallback ──────────────────────────────────────────────────
    // The scoreboard endpoint only serves current/upcoming rounds.
    // For any past date (yesterday, last week, etc.) it returns 0 events.
    // In that case, reconstruct the fixture list from individual team schedules:
    //   1. Fetch league team list (one call)
    //   2. Fetch each team's current-season schedule in parallel
    //   3. Find events whose BRT date matches the requested date
    //   4. Deduplicate by event ID → return as EspnFixture[]
    if (events.length === 0 && isPastDate) {
      try {
        events = await fetchFixturesForDate(league.espnSlug, dateBR);
        if (events.length > 0) {
          logger.info(
            { league: league.id, date: dateBR, found: events.length },
            "Used team-schedule fallback for past date",
          );
        }
      } catch (err) {
        logger.warn({ err, league: league.id }, "Past-date fallback failed");
      }
    }

    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors.find((c) => c.homeAway === "home");
      const away = comp.competitors.find((c) => c.homeAway === "away");
      if (!home || !away) continue;

      totalFixtures++;

      try {
        const kickoff = new Date(ev.date);

        // Fetch team schedules (current + previous season) AND bookmaker odds
        // in parallel. Multi-season gives more H2H history across 2 full seasons.
        const [homeSchedule, awaySchedule, bettingMarkets] = await Promise.all([
          fetchTeamScheduleMultiSeason(league.espnSlug, home.team.id),
          fetchTeamScheduleMultiSeason(league.espnSlug, away.team.id),
          // Fetch odds optimistically; returns null when ODDS_API_KEY not set
          // or league/event not found in The-Odds-API.
          fetchBettingMarkets(
            league.id,
            home.team.displayName,
            away.team.displayName,
            kickoff,
          ),
        ]);

        const homeResults = extractPastResults(homeSchedule, home.team.id, refDate);
        const awayResults = extractPastResults(awaySchedule, away.team.id, refDate);

        await bootstrapEloFromHistory(
          league,
          home.team.displayName,
          away.team.displayName,
          homeResults,
          awayResults,
        );

        const homeElo = await getElo(league.id, home.team.displayName);
        const awayElo = await getElo(league.id, away.team.displayName);

        const venueCity =
          ev.venue?.address?.city ?? comp.venue?.address?.city;
        const venueCountry =
          ev.venue?.address?.country ?? comp.venue?.address?.country;
        const weather = await fetchWeather(venueCity, venueCountry, kickoff);

        const homeHistory = pastResultsToMatches(homeResults, refDate);
        const awayHistory = pastResultsToMatches(awayResults, refDate);
        // Cross-reference BOTH schedules to find all H2H encounters,
        // including games from previous seasons and from both perspectives.
        const h2h = findH2H(
          homeResults, home.team.id, home.team.displayName,
          awayResults, away.team.id, away.team.displayName,
          refDate,
        );

        const daysRestHome = homeResults[0]
          ? daysAgo(homeResults[0].date, refDate)
          : 7;
        const daysRestAway = awayResults[0]
          ? daysAgo(awayResults[0].date, refDate)
          : 7;

        // Extract the blend-relevant subset from odds for the engine.
        // The engine's MarketOddsInput only needs oneX2, overUnder, btts.
        const marketOddsForBlend = bettingMarkets
          ? {
              oneX2: bettingMarkets.oneX2,
              overUnder: bettingMarkets.overUnder,
              btts: bettingMarkets.btts,
            }
          : undefined;

        // ── Live game detection ─────────────────────────────────────────────
        // When the game is currently in-progress (state === "in"), extract the
        // current score and elapsed minutes so the engine can adapt predictions
        // to remaining playtime (scale lambdas + offset final score).
        // Also fetch live stats (shots, xG, red cards) to feed M54-57.
        let liveState: {
          minute: number; homeScore: number; awayScore: number;
          homeXg?: number; awayXg?: number;
          homeRedCards?: number; awayRedCards?: number;
          homeSubs?: number; awaySubs?: number;
        } | undefined;
        if (ev.status.type.state === "in") {
          const homeScoreRaw = home.score != null ? Number(home.score) : undefined;
          const awayScoreRaw = away.score != null ? Number(away.score) : undefined;
          if (
            homeScoreRaw !== undefined && awayScoreRaw !== undefined &&
            Number.isFinite(homeScoreRaw) && Number.isFinite(awayScoreRaw)
          ) {
            // Parse elapsed minutes from displayClock (format: "45:23" or "67:00")
            // and period (1 = first half, 2 = second half / extra time).
            const period = ev.status.period ?? 1;
            const clockStr = ev.status.displayClock ?? "";
            const minStr = clockStr.split(":")[0] ?? "0";
            const clockMin = Math.max(0, parseInt(minStr, 10));
            // Period 1: 0-45 min; Period 2: 45-90 min
            const elapsedMin = period >= 2 ? 45 + clockMin : clockMin;
            const clampedMin = Math.max(1, Math.min(89, elapsedMin));

            // Fetch live in-game statistics (non-blocking: failure falls back to estimates)
            const liveStats = await fetchLiveMatchStats(league.espnSlug, ev.id).catch(() => null);

            liveState = {
              minute: clampedMin,
              homeScore: homeScoreRaw,
              awayScore: awayScoreRaw,
              homeXg:       liveStats?.homeXg       ?? undefined,
              awayXg:       liveStats?.awayXg       ?? undefined,
              homeRedCards: liveStats?.homeRedCards  ?? undefined,
              awayRedCards: liveStats?.awayRedCards  ?? undefined,
            };
            logger.info(
              {
                fixtureId: ev.id,
                minute: clampedMin,
                score: `${homeScoreRaw}-${awayScoreRaw}`,
                homeXg: liveStats?.homeXg,
                awayXg: liveStats?.awayXg,
                homeRedCards: liveStats?.homeRedCards,
                awayRedCards: liveStats?.awayRedCards,
              },
              "Live game detected — using in-play mode with xG tracking",
            );
          }
        }

        const report = scanFixture(
          {
            fixtureId: ev.id,
            league,
            homeTeamId: home.team.id,
            homeTeamName: home.team.displayName,
            awayTeamId: away.team.id,
            awayTeamName: away.team.displayName,
            kickoffUtc: kickoff,
            homeHistory,
            awayHistory,
            homeElo,
            awayElo,
            daysRestHome,
            daysRestAway,
            h2hSample: h2h,
            weather,
            modelState,
            // Pass odds into the engine — Market Blend runs BEFORE Monte Carlo
            marketOdds: marketOddsForBlend,
            liveState,
          },
          thresholds,
        );

        // Attach the full odds data to the report for display in the frontend.
        if (bettingMarkets) {
          report.bettingMarkets = bettingMarkets;

          // Compute edge metrics from market odds vs MC output
          if (bettingMarkets.oneX2) {
            const mcProbs = report.mcStats;
            const maxProb = Math.max(mcProbs.homeWinProb, mcProbs.drawProb, mcProbs.awayWinProb);
            let marketOdd: number | null = null;
            if (maxProb === mcProbs.homeWinProb) marketOdd = bettingMarkets.oneX2.homeOdd;
            else if (maxProb === mcProbs.drawProb) marketOdd = bettingMarkets.oneX2.drawOdd;
            else marketOdd = bettingMarkets.oneX2.awayOdd;

            if (marketOdd && marketOdd > 1) {
              report.currentOdd = marketOdd;
              const impliedProb = 1 / marketOdd;
              report.edgePct = ((maxProb - impliedProb) / impliedProb) * 100;
            }
          }

          // Use exact-score market odd for the primary prediction if available
          if (bettingMarkets.exactScore?.length) {
            const primaryKey = `${report.primary.home}-${report.primary.away}`;
            const exactOdd = bettingMarkets.exactScore.find((s) => s.score === primaryKey);
            if (exactOdd) {
              report.primary = { ...report.primary, odd: exactOdd.odd };
              const impliedProb = 1 / exactOdd.odd;
              const edgePct = ((report.primary.prob - impliedProb) / impliedProb) * 100;
              // Use exact score edge if it's stronger
              if (report.edgePct === null || Math.abs(edgePct) > Math.abs(report.edgePct)) {
                report.edgePct = edgePct;
                report.currentOdd = exactOdd.odd;
              }
            }
          }

          // Compute edge highlights for display
          const highlights = [];
          const ou = bettingMarkets.overUnder;
          if (bettingMarkets.oneX2) {
            const probs = [
              { market: "1X2 Casa", modelProb: report.mcStats.homeWinProb, odd: bettingMarkets.oneX2.homeOdd },
              { market: "1X2 Empate", modelProb: report.mcStats.drawProb, odd: bettingMarkets.oneX2.drawOdd },
              { market: "1X2 Fora", modelProb: report.mcStats.awayWinProb, odd: bettingMarkets.oneX2.awayOdd },
            ];
            for (const p of probs) {
              if (p.odd > 1) {
                const impl = 1 / p.odd;
                const edge = ((p.modelProb - impl) / impl) * 100;
                if (edge > 5) highlights.push({ market: p.market, value: `@${p.odd.toFixed(2)}`, modelProb: p.modelProb, marketOdd: p.odd, edgePct: edge });
              }
            }
          }
          if (ou) {
            const ou25 = ou.find((l) => l.line === 2.5);
            if (ou25 && ou25.overOdd > 1) {
              const impl = 1 / ou25.overOdd;
              const edge = ((report.mcStats.over25 - impl) / impl) * 100;
              if (edge > 5) highlights.push({ market: "Over 2.5", value: `@${ou25.overOdd.toFixed(2)}`, modelProb: report.mcStats.over25, marketOdd: ou25.overOdd, edgePct: edge });
            }
          }
          if (bettingMarkets.btts && bettingMarkets.btts.yesOdd > 1) {
            const impl = 1 / bettingMarkets.btts.yesOdd;
            const edge = ((report.mcStats.bttsProb - impl) / impl) * 100;
            if (edge > 5) highlights.push({ market: "BTTS Sim", value: `@${bettingMarkets.btts.yesOdd.toFixed(2)}`, modelProb: report.mcStats.bttsProb, marketOdd: bettingMarkets.btts.yesOdd, edgePct: edge });
          }
          bettingMarkets.edgeHighlights = highlights.sort((a, b) => b.edgePct - a.edgePct).slice(0, 5);
        }

        reports.push(report);

        if (report.verdict === "SINGULARITY") {
          await upsertPrediction(report);
        }
      } catch (err) {
        logger.warn(
          { err, fixtureId: ev.id, league: league.id },
          "Failed to scan fixture",
        );
      }
    }
  }

  // Sort SINGULARITIES first, then by assertiveness desc
  reports.sort((a, b) => {
    if (a.verdict !== b.verdict) {
      return a.verdict === "SINGULARITY" ? -1 : 1;
    }
    return b.assertivenessReal - a.assertivenessReal;
  });

  return {
    scannedAt: new Date().toISOString(),
    date: dateBR,
    fixturesScanned: totalFixtures,
    singularitiesFound: reports.filter((r) => r.verdict === "SINGULARITY").length,
    inconclusiveCount: reports.filter((r) => r.verdict === "INCONCLUSIVE").length,
    thresholds,
    reports,
  };
}
