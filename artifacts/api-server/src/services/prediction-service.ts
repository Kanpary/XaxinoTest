import { db, predictionsTable, type Prediction } from "@workspace/db";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { NeuralXReportOut } from "../engine/scanner";
import { fetchSummary, extractFinalScore, fetchScoreboard, fetchFixturesForDate } from "../data-sources/espn";
import { findLeague } from "../data-sources/leagues";
import { applyEloMatch } from "./elo-service";
import { incrementSinceLastCalibration } from "./model-state-service";
import { recalibrate } from "./calibration-service";
import { logger } from "../lib/logger";

function kickoffToMatchDate(kickoff: Date | string): string {
  const d = typeof kickoff === "string" ? new Date(kickoff) : kickoff;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function upsertPrediction(
  report: NeuralXReportOut,
): Promise<Prediction> {
  const kickoff = new Date(report.kickoffUtc);
  const matchDate = kickoffToMatchDate(kickoff);

  const p2 = report.topN[1];
  const p3 = report.topN[2];

  const values = {
    fixtureId: report.fixtureId,
    leagueId: report.leagueId,
    leagueName: report.leagueName,
    homeTeam: report.homeTeam,
    awayTeam: report.awayTeam,
    kickoffUtc: kickoff,
    matchDate,
    primaryHome: report.primary.home,
    primaryAway: report.primary.away,
    primaryProb: report.primary.prob,
    pred2Home: p2?.home ?? null,
    pred2Away: p2?.away ?? null,
    pred2Prob: p2?.prob ?? null,
    pred3Home: p3?.home ?? null,
    pred3Away: p3?.away ?? null,
    pred3Prob: p3?.prob ?? null,
    hedgeScoresJson: JSON.stringify(report.hedge),
    topNScoresJson: JSON.stringify(report.topN),
    assertivenessReal: report.assertivenessReal,
    ensembleConvergence: report.ensembleConvergence,
    currentOdd: report.currentOdd,
    fairValue: report.fairValue,
    edgePct: report.edgePct,
    zScore: report.zScore,
    verdict: report.verdict,
    forensicVerdict: JSON.stringify(report.forensicVerdict),
    motorsActivated: JSON.stringify(report.motorsActivated),
    xrayDriver: report.xRayDriver,
    isLive: report.isLive,
    liveMinute: report.liveMinute ?? null,
    liveHomeScore: report.liveHomeScore ?? null,
    liveAwayScore: report.liveAwayScore ?? null,
    status: "pending",
  };

  const inserted = await db
    .insert(predictionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: predictionsTable.fixtureId,
      set: {
        matchDate,
        primaryHome: values.primaryHome,
        primaryAway: values.primaryAway,
        primaryProb: values.primaryProb,
        pred2Home: values.pred2Home,
        pred2Away: values.pred2Away,
        pred2Prob: values.pred2Prob,
        pred3Home: values.pred3Home,
        pred3Away: values.pred3Away,
        pred3Prob: values.pred3Prob,
        hedgeScoresJson: values.hedgeScoresJson,
        topNScoresJson: values.topNScoresJson,
        assertivenessReal: values.assertivenessReal,
        ensembleConvergence: values.ensembleConvergence,
        zScore: values.zScore,
        forensicVerdict: values.forensicVerdict,
        motorsActivated: values.motorsActivated,
        xrayDriver: values.xrayDriver,
        isLive: values.isLive,
        liveMinute: values.liveMinute,
        liveHomeScore: values.liveHomeScore,
        liveAwayScore: values.liveAwayScore,
      },
    })
    .returning();
  return inserted[0]!;
}

export interface ListPredictionsOptions {
  status?: "pending" | "resolved" | "all";
  date?: string;
  limit?: number;
}

export async function listPredictions(
  opts: ListPredictionsOptions = {},
): Promise<Prediction[]> {
  const limit = Math.min(opts.limit ?? 500, 500);
  const status = opts.status ?? "all";

  const conditions = [];
  if (status !== "all") {
    conditions.push(eq(predictionsTable.status, status));
  }
  if (opts.date) {
    conditions.push(eq(predictionsTable.matchDate, opts.date));
  }

  const q = db
    .select()
    .from(predictionsTable)
    .orderBy(desc(predictionsTable.kickoffUtc))
    .limit(limit);

  return conditions.length > 0
    ? await q.where(conditions.length === 1 ? conditions[0]! : and(...conditions))
    : await q;
}

function kickoffToUtcDate(kickoff: Date | string): string {
  const d = typeof kickoff === "string" ? new Date(kickoff) : kickoff;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function tryScoreboardDate(
  espnSlug: string,
  fixtureId: string,
  dateYYYYMMDD: string,
): Promise<{ home: number; away: number; completed: boolean } | null> {
  try {
    const events = await fetchScoreboard(espnSlug, dateYYYYMMDD);
    const ev = events.find((e) => e.id === fixtureId);
    if (!ev) return null;
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home?.score || !away?.score) return null;
    const h = Number(home.score);
    const a = Number(away.score);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
    const completed =
      ev.status.type.completed ||
      ev.status.type.state === "post";
    if (!completed) return null;
    return { home: h, away: a, completed: true };
  } catch {
    return null;
  }
}

async function tryResolveViaScoreboard(
  p: Prediction,
): Promise<{ home: number; away: number; completed: boolean } | null> {
  const league = findLeague(p.leagueId);
  if (!league) return null;

  const brtDate = (p.matchDate ?? kickoffToMatchDate(p.kickoffUtc)).replace(/-/g, "");
  const utcDate = kickoffToUtcDate(p.kickoffUtc).replace(/-/g, "");

  // Also try the day after UTC (game may span midnight UTC)
  const utcDayAfter = (() => {
    const d = new Date(typeof p.kickoffUtc === "string" ? p.kickoffUtc : p.kickoffUtc);
    d.setUTCDate(d.getUTCDate() + 1);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
  })();

  const datesToTry = [...new Set([brtDate, utcDate, utcDayAfter])];

  for (const dateYYYYMMDD of datesToTry) {
    const score = await tryScoreboardDate(league.espnSlug, p.fixtureId, dateYYYYMMDD);
    if (score) return score;
  }

  // Bug #3 fix: for past dates the scoreboard endpoint returns 0 events.
  // Fall back to fetchFixturesForDate (team-schedule reconstruction) which
  // returns completed games for any historical date.
  const brtDateISO = (p.matchDate ?? kickoffToMatchDate(p.kickoffUtc));
  try {
    const pastFixtures = await fetchFixturesForDate(league.espnSlug, brtDateISO);
    const pastEv = pastFixtures.find((e) => e.id === p.fixtureId);
    if (pastEv) {
      const comp = pastEv.competitions?.[0];
      if (comp) {
        const home = comp.competitors.find((c) => c.homeAway === "home");
        const away = comp.competitors.find((c) => c.homeAway === "away");
        if (home?.score && away?.score) {
          const h = Number(home.score);
          const a = Number(away.score);
          const isCompleted =
            pastEv.status.type.completed === true ||
            pastEv.status.type.state === "post";
          if (Number.isFinite(h) && Number.isFinite(a) && isCompleted) {
            logger.info(
              { fixtureId: p.fixtureId, brtDate: brtDateISO, score: `${h}-${a}` },
              "Resolved via fetchFixturesForDate past-date fallback",
            );
            return { home: h, away: a, completed: true };
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, fixtureId: p.fixtureId, brtDate: brtDateISO }, "fetchFixturesForDate fallback failed");
  }

  logger.warn({ fixtureId: p.fixtureId, brtDate, utcDate }, "Scoreboard fallback: fixture not found on any date");
  return null;
}

/** Compute hit flags for a single prediction vs actual result. */
function computeHits(
  p: Prediction,
  aH: number,
  aA: number,
): {
  hitExact: boolean;
  hitExact2: boolean;
  hitExact3: boolean;
  hitAnyExact: boolean;
  hitWithinOne: boolean;
} {
  const pH = Number(p.primaryHome);
  const pA = Number(p.primaryAway);
  const hitExact = aH === pH && aA === pA;
  const hitWithinOne = Math.abs(aH - pH) <= 1 && Math.abs(aA - pA) <= 1;

  const p2H = p.pred2Home != null ? Number(p.pred2Home) : null;
  const p2A = p.pred2Away != null ? Number(p.pred2Away) : null;
  const hitExact2 = p2H !== null && p2A !== null && aH === p2H && aA === p2A;

  const p3H = p.pred3Home != null ? Number(p.pred3Home) : null;
  const p3A = p.pred3Away != null ? Number(p.pred3Away) : null;
  const hitExact3 = p3H !== null && p3A !== null && aH === p3H && aA === p3A;

  const hitAnyExact = hitExact || hitExact2 || hitExact3;

  return { hitExact, hitExact2, hitExact3, hitAnyExact, hitWithinOne };
}

/** Attempt to resolve a single pending prediction. Returns the score if resolved, null otherwise. */
async function tryResolvePrediction(
  p: Prediction,
): Promise<{ home: number; away: number } | null> {
  const league = findLeague(p.leagueId);
  if (!league) return null;

  let finalScore: { home: number; away: number; completed: boolean } | null = null;

  // Primary: ESPN summary endpoint
  try {
    const summary = await fetchSummary(league.espnSlug, p.fixtureId);
    if (summary) {
      finalScore = extractFinalScore(summary);
    }
  } catch { /* fall through */ }

  // ESPN sometimes keeps state:"in" for several minutes after full-time.
  // Only accept an in-progress score as final when AT LEAST 150 min have
  // elapsed since kickoff — this covers 90 min + AET (30 min) + penalties
  // (~10 min) + a generous buffer (20 min). Using a lower threshold (e.g.
  // 105 min) can falsely resolve games still in extra-time with wrong scores.
  if (finalScore && !finalScore.completed) {
    const kickoffMs = (p.kickoffUtc instanceof Date ? p.kickoffUtc : new Date(p.kickoffUtc)).getTime();
    const elapsedMin = (Date.now() - kickoffMs) / 60000;
    if (elapsedMin >= 150) {
      finalScore = { ...finalScore, completed: true };
      logger.info(
        { fixtureId: p.fixtureId, elapsedMin: Math.round(elapsedMin) },
        "Accepted score despite ESPN in-progress flag (elapsed >= 150 min)",
      );
    }
  }

  // Fallback: scoreboard by date (tries BRT, UTC, and UTC+1 day)
  if (!finalScore || !finalScore.completed) {
    finalScore = await tryResolveViaScoreboard(p);
  }

  if (!finalScore || !finalScore.completed) return null;
  return { home: finalScore.home, away: finalScore.away };
}

export interface SyncProgressEvent {
  type: "progress";
  checked: number;
  resolved: number;
  total: number;
  current: string;
  fixtureId: string;
  score?: string;
}

export interface SyncDoneEvent {
  type: "done";
  checked: number;
  resolved: number;
  stillPending: number;
  autoRecalibrated: boolean;
}

export type SyncEvent = SyncProgressEvent | SyncDoneEvent;

/**
 * Streaming sync — calls onEvent for each game checked and on completion.
 * This powers the SSE endpoint for real-time frontend updates.
 *
 * Key fixes vs. original:
 * - Cutoff lowered to 90min (standard FT) so recent finishes are caught
 * - 7-day lookback for games never synced (catches stale pending rows)
 * - Day-after UTC fallback in scoreboard lookup
 * - Elapsed threshold lowered from 120 to 105 min
 */
export async function syncResultsStreaming(
  onEvent: (e: SyncEvent) => void,
  opts: { date?: string } = {},
): Promise<{ checked: number; resolved: number; stillPending: number; autoRecalibrated: boolean }> {

  // Fetch all pending games that kicked off at least 90 minutes ago.
  // When a specific date is supplied (from scanner), restrict to that matchDate so we
  // don't accidentally re-process predictions from other days.
  const cutoff90 = new Date(Date.now() - 90 * 60 * 1000);

  const conditions = [
    eq(predictionsTable.status, "pending"),
    lt(predictionsTable.kickoffUtc, cutoff90),
  ];
  if (opts.date) {
    conditions.push(eq(predictionsTable.matchDate, opts.date));
  }

  const pending = await db
    .select()
    .from(predictionsTable)
    .where(and(...conditions))
    .limit(200);

  let checked = 0;
  let resolved = 0;
  const total = pending.length;

  for (const p of pending) {
    checked++;

    onEvent({
      type: "progress",
      checked,
      resolved,
      total,
      current: `${p.homeTeam} × ${p.awayTeam}`,
      fixtureId: p.fixtureId,
    });

    try {
      const score = await tryResolvePrediction(p);
      if (!score) continue;

      const hits = computeHits(p, score.home, score.away);

      await db
        .update(predictionsTable)
        .set({
          actualHome: score.home,
          actualAway: score.away,
          ...hits,
          status: "resolved",
          resolvedAt: new Date(),
        })
        .where(eq(predictionsTable.id, p.id));

      await applyEloMatch(
        p.leagueId,
        p.homeTeam,
        p.awayTeam,
        score.home,
        score.away,
      );
      await incrementSinceLastCalibration(1);
      resolved++;

      onEvent({
        type: "progress",
        checked,
        resolved,
        total,
        current: `${p.homeTeam} × ${p.awayTeam}`,
        fixtureId: p.fixtureId,
        score: `${score.home}–${score.away}`,
      });
    } catch (err) {
      logger.warn({ err, fixtureId: p.fixtureId }, "Failed to sync result");
    }
  }

  // ── RECOMPUTE PASS ──────────────────────────────────────────────────────────
  const allResolved = await db
    .select()
    .from(predictionsTable)
    .where(
      and(
        eq(predictionsTable.status, "resolved"),
        isNotNull(predictionsTable.actualHome),
        isNotNull(predictionsTable.actualAway),
      ),
    );

  let corrected = 0;
  for (const p of allResolved) {
    if (p.actualHome == null || p.actualAway == null) continue;
    const aH = Number(p.actualHome);
    const aA = Number(p.actualAway);
    const expected = computeHits(p, aH, aA);
    const storedExact = p.hitExact ?? false;
    const storedExact2 = p.hitExact2 ?? false;
    const storedExact3 = p.hitExact3 ?? false;
    const storedAny = p.hitAnyExact ?? (p.hitExact ?? false);
    const storedW1 = p.hitWithinOne ?? false;
    const needsUpdate =
      expected.hitExact !== storedExact ||
      expected.hitExact2 !== storedExact2 ||
      expected.hitExact3 !== storedExact3 ||
      expected.hitAnyExact !== storedAny ||
      expected.hitWithinOne !== storedW1;
    if (needsUpdate) {
      await db.update(predictionsTable).set(expected).where(eq(predictionsTable.id, p.id));
      corrected++;
    }
  }
  if (corrected > 0) {
    logger.info({ corrected }, "Recompute pass: corrected flag inconsistencies");
  }

  const stillPendingRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "pending"));
  const stillPending = Number(stillPendingRows[0]?.count ?? 0);

  let autoRecalibrated = false;
  if (resolved > 0 || corrected > 0) {
    const result = await recalibrate();
    if ("success" in result || "predictionsUsed" in result) {
      autoRecalibrated = true;
    }
  }

  onEvent({ type: "done", checked, resolved, stillPending, autoRecalibrated });

  return { checked, resolved, stillPending, autoRecalibrated };
}

/** Non-streaming version for backwards compatibility */
export async function syncResults(): Promise<{
  checked: number;
  resolved: number;
  stillPending: number;
  autoRecalibrated: boolean;
}> {
  return syncResultsStreaming(() => { /* no-op */ });
}

export async function getResolvedPredictions(): Promise<Prediction[]> {
  return await db
    .select()
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "resolved"))
    .orderBy(desc(predictionsTable.resolvedAt));
}
