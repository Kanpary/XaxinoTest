/**
 * The-Odds-API v4 integration — real bookmaker odds.
 * Requires ODDS_API_KEY environment variable (https://the-odds-api.com).
 * When missing or quota exceeded, all functions return null gracefully.
 *
 * Supported markets:
 *   h2h                — 1x2 moneyline
 *   totals             — over/under
 *   btts               — both teams to score
 *   exact_score        — exact scoreline
 *   halftime_fulltime  — HT/FT double result
 *   asian_handicap     — spread handicap
 */

import { logger } from "../lib/logger";

const BASE = "https://api.the-odds-api.com/v4";
const REQUEST_TIMEOUT_MS = 8000;

// Map our internal league IDs to The-Odds-API sport keys
const LEAGUE_TO_SPORT_KEY: Record<string, string> = {
  "brasileirao-a": "soccer_brazil_campeonato",
  "brasileirao-b": "soccer_brazil_serie_b",
  "argentina-primera": "soccer_argentina_primera_division",
  "colombia-primera": "soccer_colombia_primera_a",
  "chile-primera": "soccer_chile_primera_division",
  "ecuador-liga-pro": "soccer_ecuador_primera_a",
  "peru-liga-1": "soccer_peru_primera_division",
  "uruguay-primera": "soccer_uruguay_primera_division",
  "venezuela-primera": "soccer_venezuela_primera_division",
  "libertadores": "soccer_conmebol_copa_libertadores",
  "sudamericana": "soccer_conmebol_copa_sudamericana",
  "la-liga": "soccer_spain_la_liga",
  "la-liga-2": "soccer_spain_segunda_division",
  "premier-league": "soccer_epl",
  "championship": "soccer_efl_champ",
  "bundesliga": "soccer_germany_bundesliga",
  "bundesliga-2": "soccer_germany_bundesliga2",
  "serie-a": "soccer_italy_serie_a",
  "serie-b": "soccer_italy_serie_b",
  "ligue-1": "soccer_france_ligue_1",
  "ligue-2": "soccer_france_ligue_2",
  "eredivisie": "soccer_netherlands_eredivisie",
  "primeira-liga": "soccer_portugal_primeira_liga",
  "super-lig": "soccer_turkey_super_league",
  "super-league": "soccer_greece_super_league",
  "pro-league": "soccer_belgium_first_div",
  "jupiler": "soccer_belgium_first_div",
  "superliga": "soccer_denmark_superliga",
  "allsvenskan": "soccer_sweden_allsvenskan",
  "eliteserien": "soccer_norway_eliteserien",
  "veikkausliiga": "soccer_finland_veikkausliiga",
  "champions-league": "soccer_uefa_champs_league",
  "europa-league": "soccer_uefa_europa_league",
  "conference-league": "soccer_uefa_europa_conference_league",
  "nations-league": "soccer_uefa_nations_league",
  "world-cup": "soccer_fifa_world_cup",
  "mls": "soccer_usa_mls",
  "liga-mx": "soccer_mexico_ligamx",
  "j-league": "soccer_japan_j_league",
  "k-league": "soccer_korea_kleague1",
  "super-league-china": "soccer_china_superleague",
  "a-league": "soccer_australia_aleague",
  "saudi-pro-league": "soccer_saudi_arabias_professional_league",
};

export interface OneX2Odds {
  homeOdd: number;
  drawOdd: number;
  awayOdd: number;
}

export interface OverUnderLine {
  line: number;
  overOdd: number;
  underOdd: number;
}

export interface BttsOdds {
  yesOdd: number;
  noOdd: number;
}

export interface ExactScoreOutcome {
  score: string;
  odd: number;
}

export interface HtFtOutcome {
  ht: string;
  ft: string;
  odd: number;
}

export interface HandicapLine {
  spread: number;
  homeOdd: number;
  awayOdd: number;
}

export interface EdgeHighlight {
  market: string;
  value: string;
  modelProb: number;
  marketOdd: number;
  edgePct: number;
}

export interface BettingMarketsData {
  bookmaker: string;
  oneX2?: OneX2Odds;
  overUnder?: OverUnderLine[];
  btts?: BttsOdds;
  exactScore?: ExactScoreOutcome[];
  htFt?: HtFtOutcome[];
  handicap?: HandicapLine[];
  edgeHighlights?: EdgeHighlight[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

async function getJson<T>(url: string): Promise<T | null> {
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) return null;

  const fullUrl = url.includes("?")
    ? `${url}&apiKey=${apiKey}`
    : `${url}?apiKey=${apiKey}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(fullUrl, { signal: ctrl.signal });
    if (res.status === 422) {
      logger.warn({ url }, "Odds API: sport key not found or market unavailable");
      return null;
    }
    if (res.status === 401 || res.status === 403) {
      logger.warn({ url }, "Odds API: invalid API key");
      return null;
    }
    if (res.status === 429) {
      logger.warn({ url }, "Odds API: quota exceeded");
      return null;
    }
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "Odds API non-OK response");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ err, url }, "Odds API request failed");
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Normalize team name for fuzzy matching across bookmakers
function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\b(fc|ac|sc|cd|cf|rc|rcd|ud|sd|sv|bv|fk|nk|as|ss|ssc|afc|bfc|hfc|ec|se|sfc|cr|crf|esporte|clube|sport|futebol|foot|football|atletico|atletismo)\b/g,
      "",
    )
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function teamsMatch(espnName: string, apiName: string): boolean {
  const a = normalizeTeam(espnName);
  const b = normalizeTeam(apiName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Word-level overlap — require at least 60% of the shorter name's words to match
  const wa = a.split(" ").filter((s) => s.length > 2);
  const wb = b.split(" ").filter((s) => s.length > 2);
  if (wa.length === 0 || wb.length === 0) return false;
  const intersection = wa.filter((w) => wb.includes(w));
  return (
    intersection.length > 0 &&
    intersection.length >= Math.min(wa.length, wb.length) * 0.6
  );
}

function findPreferredBookmaker(bookmakers: OddsApiBookmaker[]): OddsApiBookmaker | null {
  const PRIORITY = ["betfair", "pinnacle", "bet365", "draftkings", "fanduel", "williamhill", "unibet"];
  for (const key of PRIORITY) {
    const bm = bookmakers.find((b) => b.key === key);
    if (bm) return bm;
  }
  return bookmakers[0] ?? null;
}

function parseH2H(bm: OddsApiBookmaker, homeTeam: string, awayTeam: string): OneX2Odds | undefined {
  const market = bm.markets.find((m) => m.key === "h2h");
  if (!market) return undefined;

  // outcomes may be [home, draw, away] or [home, away] (no draw)
  const home = market.outcomes.find((o) =>
    teamsMatch(o.name, homeTeam) || o.name.toLowerCase().includes("home"),
  );
  const away = market.outcomes.find((o) =>
    teamsMatch(o.name, awayTeam) || o.name.toLowerCase().includes("away"),
  );
  const draw = market.outcomes.find((o) =>
    o.name.toLowerCase() === "draw" || o.name.toLowerCase() === "tie",
  );

  if (!home || !away) return undefined;
  return {
    homeOdd: home.price,
    drawOdd: draw?.price ?? 0,
    awayOdd: away.price,
  };
}

function parseTotals(bm: OddsApiBookmaker): OverUnderLine[] {
  const market = bm.markets.find((m) => m.key === "totals");
  if (!market) return [];

  const lineMap = new Map<number, Partial<OverUnderLine>>();
  for (const o of market.outcomes) {
    const line = o.point ?? 2.5;
    if (!lineMap.has(line)) lineMap.set(line, { line });
    const entry = lineMap.get(line)!;
    if (o.name.toLowerCase() === "over") entry.overOdd = o.price;
    else if (o.name.toLowerCase() === "under") entry.underOdd = o.price;
  }

  return [...lineMap.values()]
    .filter((l): l is OverUnderLine => l.overOdd != null && l.underOdd != null)
    .sort((a, b) => a.line - b.line);
}

function parseBtts(bm: OddsApiBookmaker): BttsOdds | undefined {
  const market = bm.markets.find((m) => m.key === "btts");
  if (!market) return undefined;
  const yes = market.outcomes.find((o) => o.name.toLowerCase() === "yes");
  const no = market.outcomes.find((o) => o.name.toLowerCase() === "no");
  if (!yes || !no) return undefined;
  return { yesOdd: yes.price, noOdd: no.price };
}

function parseExactScore(bm: OddsApiBookmaker): ExactScoreOutcome[] {
  const market = bm.markets.find((m) => m.key === "exact_score" || m.key === "player_pass_tds");
  const exactMarket = bm.markets.find((m) => m.key === "exact_score");
  if (!exactMarket) return [];

  return exactMarket.outcomes
    .filter((o) => /^\d+-\d+$/.test(o.name) || /^\d+:\d+$/.test(o.name))
    .map((o) => ({ score: o.name.replace(":", "-"), odd: o.price }))
    .sort((a, b) => a.odd - b.odd)
    .slice(0, 15);
}

function parseHtFt(bm: OddsApiBookmaker): HtFtOutcome[] {
  const market = bm.markets.find((m) => m.key === "halftime_fulltime" || m.key === "h2h_halftime_fulltime");
  if (!market) return [];

  return market.outcomes.map((o) => {
    // Format: "Home/Home", "Home/Draw", "Draw/Away", etc.
    const parts = o.name.split("/");
    return {
      ht: parts[0]?.trim() ?? o.name,
      ft: parts[1]?.trim() ?? o.name,
      odd: o.price,
    };
  });
}

function parseHandicap(bm: OddsApiBookmaker, homeTeam: string, awayTeam: string): HandicapLine[] {
  const market = bm.markets.find((m) => m.key === "asian_handicap" || m.key === "spreads");
  if (!market) return [];

  const lineMap = new Map<number, Partial<HandicapLine>>();
  for (const o of market.outcomes) {
    const spread = o.point ?? 0;
    if (!lineMap.has(spread)) lineMap.set(spread, { spread });
    const entry = lineMap.get(spread)!;
    if (teamsMatch(o.name, homeTeam)) entry.homeOdd = o.price;
    else if (teamsMatch(o.name, awayTeam)) entry.awayOdd = o.price;
  }

  return [...lineMap.values()]
    .filter((l): l is HandicapLine => l.homeOdd != null && l.awayOdd != null)
    .sort((a, b) => a.spread - b.spread);
}

/**
 * Compute edge highlights: markets where model probabilities disagree
 * with bookmaker implied probabilities by more than 5%.
 */
function computeEdgeHighlights(
  markets: BettingMarketsData,
  modelProbs: {
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    over25: number;
    bttsProb: number;
  },
): EdgeHighlight[] {
  const highlights: EdgeHighlight[] = [];

  if (markets.oneX2) {
    const checks = [
      { label: "1X2 Casa", modelProb: modelProbs.homeWinProb, odd: markets.oneX2.homeOdd },
      { label: "1X2 Empate", modelProb: modelProbs.drawProb, odd: markets.oneX2.drawOdd },
      { label: "1X2 Fora", modelProb: modelProbs.awayWinProb, odd: markets.oneX2.awayOdd },
    ];
    for (const c of checks) {
      if (c.odd > 0) {
        const impliedProb = 1 / c.odd;
        const edgePct = ((c.modelProb - impliedProb) / impliedProb) * 100;
        if (edgePct > 5) {
          highlights.push({ market: c.label, value: `@${c.odd.toFixed(2)}`, modelProb: c.modelProb, marketOdd: c.odd, edgePct });
        }
      }
    }
  }

  if (markets.overUnder) {
    const ou25 = markets.overUnder.find((l) => l.line === 2.5);
    if (ou25) {
      const edgePct = ((modelProbs.over25 - 1 / ou25.overOdd) / (1 / ou25.overOdd)) * 100;
      if (edgePct > 5) {
        highlights.push({ market: "Over 2.5", value: `@${ou25.overOdd.toFixed(2)}`, modelProb: modelProbs.over25, marketOdd: ou25.overOdd, edgePct });
      }
    }
  }

  if (markets.btts) {
    const impliedYes = 1 / markets.btts.yesOdd;
    const edgePct = ((modelProbs.bttsProb - impliedYes) / impliedYes) * 100;
    if (edgePct > 5) {
      highlights.push({ market: "BTTS Sim", value: `@${markets.btts.yesOdd.toFixed(2)}`, modelProb: modelProbs.bttsProb, marketOdd: markets.btts.yesOdd, edgePct });
    }
  }

  return highlights.sort((a, b) => b.edgePct - a.edgePct).slice(0, 5);
}

interface FetchOddsForDayResult {
  events: OddsApiEvent[];
  sportKey: string;
}

// Cache per sport key per day to minimize API calls
const _dayCache = new Map<string, OddsApiEvent[]>();

async function fetchEventsForSport(sportKey: string, dateYYYYMMDD: string): Promise<OddsApiEvent[]> {
  const cacheKey = `${sportKey}:${dateYYYYMMDD}`;
  if (_dayCache.has(cacheKey)) return _dayCache.get(cacheKey)!;

  // Build date range: from midnight to midnight of that day UTC
  const dateFrom = `${dateYYYYMMDD.slice(0, 4)}-${dateYYYYMMDD.slice(4, 6)}-${dateYYYYMMDD.slice(6, 8)}T00:00:00Z`;
  const dateTo = `${dateYYYYMMDD.slice(0, 4)}-${dateYYYYMMDD.slice(4, 6)}-${dateYYYYMMDD.slice(6, 8)}T23:59:59Z`;

  const markets = "h2h,totals,btts,exact_score,halftime_fulltime,asian_handicap";
  const url = `${BASE}/sports/${sportKey}/odds/?regions=eu,uk&markets=${markets}&oddsFormat=decimal&dateFormat=iso&commenceTimeFrom=${dateFrom}&commenceTimeTo=${dateTo}`;

  const events = await getJson<OddsApiEvent[]>(url);
  const result = events ?? [];
  _dayCache.set(cacheKey, result);
  return result;
}

/**
 * Fetch betting markets for a specific fixture.
 *
 * @param leagueId    - Internal league ID (maps to The-Odds-API sport key)
 * @param homeTeam    - ESPN home team display name
 * @param awayTeam    - ESPN away team display name
 * @param kickoffUtc  - Fixture kickoff time
 * @param modelProbs  - Model-derived probabilities for edge computation
 */
export async function fetchBettingMarkets(
  leagueId: string,
  homeTeam: string,
  awayTeam: string,
  kickoffUtc: Date,
  modelProbs?: {
    homeWinProb: number;
    drawProb: number;
    awayWinProb: number;
    over25: number;
    bttsProb: number;
  },
): Promise<BettingMarketsData | null> {
  if (!process.env["ODDS_API_KEY"]) return null;

  const sportKey = LEAGUE_TO_SPORT_KEY[leagueId];
  if (!sportKey) {
    logger.debug({ leagueId }, "Odds API: no sport key mapping for league");
    return null;
  }

  // Format date as YYYYMMDD from kickoff
  const dateYYYYMMDD = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(kickoffUtc)
    .replace(/-/g, "");

  const events = await fetchEventsForSport(sportKey, dateYYYYMMDD);
  if (!events.length) return null;

  // Find the matching event by team names + time proximity (±2 hours)
  const kickoffMs = kickoffUtc.getTime();
  const match = events.find((ev) => {
    const evMs = new Date(ev.commence_time).getTime();
    const timeDiff = Math.abs(evMs - kickoffMs);
    if (timeDiff > 2 * 60 * 60 * 1000) return false;
    return (
      (teamsMatch(ev.home_team, homeTeam) && teamsMatch(ev.away_team, awayTeam)) ||
      // Also try reversed (some APIs swap)
      (teamsMatch(ev.home_team, awayTeam) && teamsMatch(ev.away_team, homeTeam))
    );
  });

  if (!match) {
    logger.debug(
      { leagueId, homeTeam, awayTeam, date: dateYYYYMMDD },
      "Odds API: no matching event found",
    );
    return null;
  }

  const bm = findPreferredBookmaker(match.bookmakers);
  if (!bm) return null;

  const result: BettingMarketsData = { bookmaker: bm.title };

  const h2h = parseH2H(bm, match.home_team, match.away_team);
  if (h2h) result.oneX2 = h2h;

  const totals = parseTotals(bm);
  if (totals.length) result.overUnder = totals;

  const btts = parseBtts(bm);
  if (btts) result.btts = btts;

  const exact = parseExactScore(bm);
  if (exact.length) result.exactScore = exact;

  const htft = parseHtFt(bm);
  if (htft.length) result.htFt = htft;

  const handicap = parseHandicap(bm, match.home_team, match.away_team);
  if (handicap.length) result.handicap = handicap;

  if (modelProbs && Object.keys(result).length > 1) {
    result.edgeHighlights = computeEdgeHighlights(result, modelProbs);
  }

  // Update currentOdd from 1x2 home win probability if available
  logger.info(
    { leagueId, homeTeam, awayTeam, bookmaker: bm.title },
    "Odds API: markets fetched successfully",
  );

  return result;
}

/**
 * Clear the per-sport-key day cache (call between scanner runs if needed).
 */
export function clearOddsCache(): void {
  _dayCache.clear();
}
