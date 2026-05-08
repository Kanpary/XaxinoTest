/**
 * ESPN public soccer endpoints. No API key, free, undocumented but stable.
 *
 *   /apis/site/v2/sports/soccer/{slug}/scoreboard?dates=YYYYMMDD
 *   /apis/site/v2/sports/soccer/{slug}/teams/{teamId}/schedule
 *   /apis/site/v2/sports/soccer/{slug}/teams   (league team list)
 *
 * IMPORTANT: The scoreboard endpoint ONLY returns current/upcoming rounds.
 * For past dates it returns 0 events. Historical fixtures must be reconstructed
 * from individual team schedules via fetchFixturesForDate().
 */

import { logger } from "../lib/logger";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SUMMARY_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/soccer";

const REQUEST_TIMEOUT_MS = 12000;

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OmniTitaniumScanner/1.0; +https://replit.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "ESPN non-OK response");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err, url }, "ESPN request failed");
    return null;
  } finally {
    clearTimeout(t);
  }
}

export interface EspnFixtureCompetitor {
  id: string;
  homeAway: "home" | "away";
  team: {
    id: string;
    displayName: string;
    abbreviation?: string;
    logo?: string;
  };
  score?: string;
  winner?: boolean;
  records?: Array<{ name: string; summary: string }>;
}

export interface EspnFixture {
  id: string;
  date: string; // ISO
  status: {
    type: {
      id: string;
      name: string;
      state: "pre" | "in" | "post";
      completed: boolean;
      shortDetail: string;
    };
    period?: number;
    displayClock?: string;
  };
  venue?: { fullName?: string; address?: { city?: string; country?: string } };
  competitions: Array<{
    id: string;
    venue?: {
      fullName?: string;
      address?: { city?: string; country?: string };
    };
    competitors: EspnFixtureCompetitor[];
  }>;
}

export interface EspnScoreboardResponse {
  events?: EspnFixture[];
  leagues?: Array<{ id: string; name: string; abbreviation?: string }>;
}

export async function fetchScoreboard(
  espnSlug: string,
  dateYYYYMMDD: string,
): Promise<EspnFixture[]> {
  const url = `${BASE}/${espnSlug}/scoreboard?dates=${dateYYYYMMDD}`;
  const data = await getJson<EspnScoreboardResponse>(url);
  return data?.events ?? [];
}

// ── League team list ─────────────────────────────────────────────────────────

export interface LeagueTeam {
  id: string;
  displayName: string;
}

interface EspnTeamsApiResponse {
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{
        team: { id: string; displayName: string };
      }>;
    }>;
  }>;
}

/**
 * Returns all active team IDs + display names for a given ESPN league slug.
 * Used by fetchFixturesForDate to discover which teams to query.
 */
export async function fetchLeagueTeams(espnSlug: string): Promise<LeagueTeam[]> {
  const url = `${BASE}/${espnSlug}/teams`;
  const data = await getJson<EspnTeamsApiResponse>(url);
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return teams.map((t) => ({ id: t.team.id, displayName: t.team.displayName }));
}

/**
 * Fallback fixture discovery for past dates.
 *
 * ESPN's scoreboard endpoint only returns current/upcoming rounds — it returns
 * 0 events for any date in the past. This function reconstructs historical
 * fixtures by:
 *   1. Fetching the full team list for the league.
 *   2. Querying each team's current-season schedule in parallel.
 *   3. Finding events whose BRT kickoff date matches dateBR.
 *   4. Deduplicating by event ID and converting to EspnFixture format.
 *
 * The returned fixtures include completed (state=post) games so the scanner
 * can run backtesting / historical analysis.
 */
export async function fetchFixturesForDate(
  espnSlug: string,
  dateBR: string,
): Promise<EspnFixture[]> {
  const teams = await fetchLeagueTeams(espnSlug);
  if (teams.length === 0) return [];

  const brtFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Fetch current-season schedule for every team in parallel (no season param
  // = current season, which covers the whole calendar year including past rounds).
  const schedules = await Promise.all(
    teams.map((t) => fetchTeamSchedule(espnSlug, t.id)),
  );

  const fixtureMap = new Map<string, EspnFixture>();

  for (const events of schedules) {
    for (const ev of events) {
      if (fixtureMap.has(ev.id)) continue;

      const parsed = new Date(ev.date);
      if (Number.isNaN(parsed.getTime())) continue;
      if (brtFmt.format(parsed) !== dateBR) continue;

      const comp = ev.competitions?.[0];
      if (!comp) continue;

      const homeComp = comp.competitors.find((c) => c.homeAway === "home");
      const awayComp = comp.competitors.find((c) => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const homeId = resolveTeamId(homeComp);
      const awayId = resolveTeamId(awayComp);
      if (!homeId || !awayId) continue;

      const homeTeam = teams.find((t) => t.id === homeId);
      const awayTeam = teams.find((t) => t.id === awayId);

      // Convert score from team-schedule format (object|string|undefined) to
      // EspnFixtureCompetitor's string format.
      const toScoreStr = (
        s: { value?: number; displayValue?: string; [key: string]: unknown } | string | undefined,
      ): string | undefined => {
        if (s == null) return undefined;
        if (typeof s === "string") return s;
        if (typeof s.value === "number") return String(s.value);
        if (typeof s.displayValue === "string") return s.displayValue;
        return undefined;
      };

      fixtureMap.set(ev.id, {
        id: ev.id,
        date: ev.date,
        status: {
          type: {
            id: comp.status?.type?.state ?? "pre",
            name: comp.status?.type?.state ?? "pre",
            state: (comp.status?.type?.state ?? "pre") as "pre" | "in" | "post",
            completed: comp.status?.type?.completed ?? false,
            shortDetail: "",
          },
        },
        competitions: [
          {
            id: ev.id,
            competitors: [
              {
                id: homeId,
                homeAway: "home",
                team: {
                  id: homeId,
                  displayName: homeTeam?.displayName ?? resolveTeamName(homeComp),
                },
                score: toScoreStr(homeComp.score),
              },
              {
                id: awayId,
                homeAway: "away",
                team: {
                  id: awayId,
                  displayName: awayTeam?.displayName ?? resolveTeamName(awayComp),
                },
                score: toScoreStr(awayComp.score),
              },
            ],
          },
        ],
      });
    }
  }

  return Array.from(fixtureMap.values());
}

export interface EspnTeamScheduleEvent {
  id: string;
  date: string;
  competitions: Array<{
    competitors: Array<{
      /** Top-level competitor ID — always equals the team's numeric ID in soccer. */
      id: string;
      homeAway: "home" | "away";
      /**
       * Team sub-object. May be a lazy `$ref`-only object in some responses
       * (ESPN internal API behaviour). Always prefer `id` at this level as fallback.
       */
      team?: {
        id?: string;
        displayName?: string;
        location?: string;
      };
      score?: { value?: number; displayValue?: string; [key: string]: unknown } | string;
      winner?: boolean;
    }>;
    status?: {
      type?: { state: string; completed?: boolean };
    };
  }>;
}

export interface EspnTeamScheduleResponse {
  events?: EspnTeamScheduleEvent[];
  team?: { id: string; displayName: string };
}

export async function fetchTeamSchedule(
  espnSlug: string,
  teamId: string,
  season?: number,
): Promise<EspnTeamScheduleEvent[]> {
  const seasonParam = season ? `?season=${season}` : "";
  const url = `${BASE}/${espnSlug}/teams/${teamId}/schedule${seasonParam}`;
  const data = await getJson<EspnTeamScheduleResponse>(url);
  return data?.events ?? [];
}

/**
 * Fetches current + 2 previous seasons for a team and merges them.
 * Deduplicates by event ID so overlapping events aren't doubled.
 * 3 seasons of history gives substantially better H2H coverage —
 * for most clubs this yields 4–6 H2H confrontations per classic rivalry.
 */
export async function fetchTeamScheduleMultiSeason(
  espnSlug: string,
  teamId: string,
): Promise<EspnTeamScheduleEvent[]> {
  const currentYear = new Date().getFullYear();
  const [current, prev1, prev2] = await Promise.all([
    fetchTeamSchedule(espnSlug, teamId),
    fetchTeamSchedule(espnSlug, teamId, currentYear - 1),
    fetchTeamSchedule(espnSlug, teamId, currentYear - 2),
  ]);
  const seen = new Set<string>();
  const merged: EspnTeamScheduleEvent[] = [];
  for (const ev of [...current, ...prev1, ...prev2]) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      merged.push(ev);
    }
  }
  return merged;
}

export interface PastResult {
  date: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  opponent: string;
  opponentId?: string;
}

/**
 * Resolve a competitor's team ID robustly.
 *
 * ESPN sometimes returns competitors where `team` is a lazy `$ref` object
 * (e.g. `{ "$ref": "http://..." }`) without `id` populated.
 * In that case we fall back to the top-level `competitor.id`, which is always
 * the numeric team ID in soccer league schedules.
 */
function resolveTeamId(
  c: EspnTeamScheduleEvent["competitions"][number]["competitors"][number],
): string | undefined {
  // Primary: team sub-object with id present
  if (c.team?.id && typeof c.team.id === "string" && c.team.id.trim() !== "") {
    return c.team.id;
  }
  // Fallback: top-level competitor id (always populated, equals team id in soccer)
  if (c.id && typeof c.id === "string" && c.id.trim() !== "") {
    return c.id;
  }
  return undefined;
}

function resolveTeamName(
  c: EspnTeamScheduleEvent["competitions"][number]["competitors"][number],
): string {
  return c.team?.displayName ?? c.team?.location ?? c.id ?? "Unknown";
}

export function extractPastResults(
  events: EspnTeamScheduleEvent[],
  teamId: string,
  upToDate: Date,
): PastResult[] {
  const results: PastResult[] = [];
  for (const ev of events) {
    const evDate = new Date(ev.date);
    if (Number.isNaN(evDate.getTime()) || evDate >= upToDate) continue;
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const status = comp.status?.type;
    // Only include definitively finished matches.
    // Accept: completed===true OR state==="post".
    // Also accept when status is absent (some schedule endpoints omit it for
    // clearly historical events).
    if (status) {
      const isFinished = status.completed === true || status.state === "post";
      if (!isFinished) continue;
    }
    const me = comp.competitors.find((c) => resolveTeamId(c) === teamId);
    const opp = comp.competitors.find((c) => resolveTeamId(c) !== teamId);
    if (!me || !opp) continue;
    const meScore = parseScore(me.score);
    const oppScore = parseScore(opp.score);
    if (meScore === null || oppScore === null) continue;
    const oppId = resolveTeamId(opp);
    results.push({
      date: ev.date,
      isHome: me.homeAway === "home",
      goalsFor: meScore,
      goalsAgainst: oppScore,
      opponent: resolveTeamName(opp),
      opponentId: oppId,
    });
  }
  results.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return results;
}

function parseScore(
  s:
    | { value?: number; displayValue?: string }
    | string
    | undefined
    | null,
): number | null {
  if (s == null) return null;
  if (typeof s === "string") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof s.value === "number") return s.value;
  if (s.displayValue) {
    const n = Number(s.displayValue);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface EspnSummary {
  header?: {
    competitions?: Array<{
      competitors?: Array<{
        homeAway: string;
        team?: { id: string; displayName: string };
        score?: string;
        winner?: boolean;
      }>;
      status?: {
        type?: { completed?: boolean; state?: string };
      };
    }>;
  };
  boxscore?: {
    teams?: Array<{
      homeAway: string;
      statistics?: Array<{
        name: string;
        displayValue?: string;
        value?: number;
      }>;
    }>;
  };
}

export interface LiveMatchStats {
  /** Estimated or direct xG for home team (null if unavailable) */
  homeXg: number | null;
  /** Estimated or direct xG for away team (null if unavailable) */
  awayXg: number | null;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeRedCards: number;
  awayRedCards: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homePossession: number | null;
  awayPossession: number | null;
}

function findStat(
  stats: Array<{ name: string; displayValue?: string; value?: number }>,
  ...names: string[]
): number | null {
  for (const name of names) {
    const s = stats.find((x) => x.name === name);
    if (s) {
      if (typeof s.value === "number" && Number.isFinite(s.value)) return s.value;
      if (s.displayValue) {
        const n = parseFloat(s.displayValue);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

/**
 * Fetches live in-game statistics (shots, xG, red cards, possession) from
 * the ESPN summary API boxscore. Used to feed real-time data into M54-57
 * (Bayesian Live Context xG blend + red card / substitution adjustments).
 *
 * xG estimation fallback: when ESPN doesn't expose expectedGoals directly,
 * estimate from shots on target (xG ≈ 0.32 per shot on target) and
 * shots off target (xG ≈ 0.04 each) — a standard simplified xG model.
 */
export async function fetchLiveMatchStats(
  espnSlug: string,
  eventId: string,
): Promise<LiveMatchStats | null> {
  const url = `${SUMMARY_BASE}/${espnSlug}/summary?event=${eventId}`;
  const data = await getJson<EspnSummary>(url);
  if (!data?.boxscore?.teams) return null;

  const homeTeam = data.boxscore.teams.find((t) => t.homeAway === "home");
  const awayTeam = data.boxscore.teams.find((t) => t.homeAway === "away");
  if (!homeTeam || !awayTeam) return null;

  const hStats = homeTeam.statistics ?? [];
  const aStats = awayTeam.statistics ?? [];

  const homeShots       = findStat(hStats, "totalShots", "shots") ?? 0;
  const awayShots       = findStat(aStats, "totalShots", "shots") ?? 0;
  const homeShotsOnTgt  = findStat(hStats, "shotsOnTarget", "onTarget", "shotsOnGoal") ?? 0;
  const awayShotsOnTgt  = findStat(aStats, "shotsOnTarget", "onTarget", "shotsOnGoal") ?? 0;
  const homeRedCards    = findStat(hStats, "redCards") ?? 0;
  const awayRedCards    = findStat(aStats, "redCards") ?? 0;
  const homeYellowCards = findStat(hStats, "yellowCards") ?? 0;
  const awayYellowCards = findStat(aStats, "yellowCards") ?? 0;
  const homePoss        = findStat(hStats, "possessionPct", "possession");
  const awayPoss        = findStat(aStats, "possessionPct", "possession");

  // Direct xG from ESPN (not always available)
  const homeXgDirect = findStat(hStats, "expectedGoals", "xG", "xg");
  const awayXgDirect = findStat(aStats, "expectedGoals", "xG", "xg");

  // Fallback: estimate from shots (simplified xG model)
  const homeXgEst = homeShotsOnTgt * 0.32 + Math.max(0, homeShots - homeShotsOnTgt) * 0.04;
  const awayXgEst = awayShotsOnTgt * 0.32 + Math.max(0, awayShots - awayShotsOnTgt) * 0.04;

  return {
    homeXg:           homeXgDirect ?? (homeShots > 0 ? homeXgEst : null),
    awayXg:           awayXgDirect ?? (awayShots > 0 ? awayXgEst : null),
    homeShots,
    awayShots,
    homeShotsOnTarget: homeShotsOnTgt,
    awayShotsOnTarget: awayShotsOnTgt,
    homeRedCards,
    awayRedCards,
    homeYellowCards,
    awayYellowCards,
    homePossession:   homePoss,
    awayPossession:   awayPoss,
  };
}

export async function fetchSummary(
  espnSlug: string,
  eventId: string,
): Promise<EspnSummary | null> {
  const url = `${SUMMARY_BASE}/${espnSlug}/summary?event=${eventId}`;
  return await getJson<EspnSummary>(url);
}

export function extractFinalScore(
  summary: EspnSummary,
): { home: number; away: number; completed: boolean } | null {
  const comp = summary?.header?.competitions?.[0];
  if (!comp) return null;
  // FIX: Accept both completed===true AND state==="post" (ESPN sometimes sends
  // state "post" without the completed flag set for recently finished games).
  const completed =
    comp.status?.type?.completed === true ||
    comp.status?.type?.state === "post";
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away || home.score == null || away.score == null) {
    return null;
  }
  const h = Number(home.score);
  const a = Number(away.score);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { home: h, away: a, completed };
}
