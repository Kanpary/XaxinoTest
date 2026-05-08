/**
 * Contextual & Situational Factors
 *
 * Methods implemented:
 * M61 — Dynamic Home Advantage (crowd density + post-COVID correction)
 * M62 — Motivation Index (title/relegation/nothing to play for)
 * M63 — Season Stage Model (early regression + late amplification)
 * M64 — Advanced H2H Analysis (venue-specific + scoreline recurrence)
 *
 * References:
 *   Pollard (2008) "Home advantage in football: A current review of an unsolved puzzle"
 *   Lago-Peñas & Lago-Ballesteros (2011) "Game location and team quality effects"
 *   Nevill et al (2002) "The influence of crowd noise and experience upon refereeing decisions"
 */

import type { PastMatch } from "./weighted-form.js";

export interface ContextualInput {
  /** Home advantage context */
  attendanceRatio?: number;       // 0-1: actual/capacity
  stadiumCapacity?: number;
  isNeutralVenue?: boolean;
  /** Match importance */
  homeTablePosition?: number;     // 1-20
  awayTablePosition?: number;
  totalTeamsInLeague?: number;    // default 20
  homePointsFromSafety?: number;  // positive = above relegation
  awayPointsFromSafety?: number;
  homePointsFromTitle?: number;   // positive = from lead (leader has 0)
  awayPointsFromTitle?: number;
  matchweek?: number;
  totalMatchweeks?: number;       // default 38
  /** H2H history */
  h2hMatches?: PastMatch[];       // matches between these two teams specifically
  /** Optional: is this a relegation playoff or title decider */
  isDecider?: boolean;
}

export interface ContextualResult {
  /** Home advantage multiplier (multiply home lambda by this) */
  dynamicHomeAdvantage: number;
  /** Motivation multipliers */
  homeMotivationMult: number;
  awayMotivationMult: number;
  /** Season stage adjustment (multiplier for expected goals) */
  seasonStageMultiplier: number;
  /** H2H insights */
  h2hHomeWinRate: number;
  h2hDrawRate: number;
  h2hAwayWinRate: number;
  h2hAvgTotalGoals: number;
  h2hMostCommonScores: Array<{ home: number; away: number; count: number }>;
  h2hScorelineRecurrenceFactor: number;   // boost if a scoreline repeats in H2H
  /** Context flags */
  isDeciderMatch: boolean;
  motivationContext: string;
  crowdEffect: string;
}

/** Base home advantage: +0.3 lambda equivalent (Pollard 2008)
 *  Full crowd multiplier: 1.0 (baseline)
 *  Empty stadium (post-COVID): 0.80
 *  Partial crowd: interpolated
 */
function dynamicHomeAdv(
  attendanceRatio: number,
  isNeutral: boolean,
): { multiplier: number; description: string } {
  if (isNeutral) return { multiplier: 1.0, description: "campo neutro" };

  const baseMult = 1.12; // 12% advantage at full stadium
  const emptyCorrMult = 0.95; // 5% advantage with empty stadium (still exists via familiarity)
  const crowdMult = emptyCorrMult + (baseMult - emptyCorrMult) * attendanceRatio;

  let desc = "estádio vazio";
  if (attendanceRatio > 0.9) desc = "estádio lotado";
  else if (attendanceRatio > 0.6) desc = "boa presença";
  else if (attendanceRatio > 0.3) desc = "presença parcial";

  return { multiplier: crowdMult, description: desc };
}

/** Motivation multiplier based on table position and stakes */
function motivationMultiplier(
  tablePos: number,
  totalTeams: number,
  pointsFromSafety: number,
  pointsFromTitle: number,
  matchweek: number,
  totalMatchweeks: number,
  isDecider: boolean,
): { mult: number; context: string } {
  const seasonProgress = matchweek / totalMatchweeks;
  const isLateSeaon = seasonProgress > 0.75;
  const relegationZone = tablePos > totalTeams - 3;
  const titleContender = tablePos <= 3;
  const midTable = !relegationZone && !titleContender;

  // Nothing to play for: safe from relegation AND no hope for title
  const safe = pointsFromSafety > 12 && !titleContender;
  const eliminated = pointsFromTitle > 15 && !relegationZone && isLateSeaon;

  if (safe && eliminated) {
    return { mult: 0.88, context: "sem nada a jogar" };
  }

  if (isDecider) {
    return { mult: 1.15, context: "jogo decisivo" };
  }

  if (relegationZone && isLateSeaon) {
    return { mult: 1.12, context: "luta contra rebaixamento" };
  }

  if (titleContender && isLateSeaon && pointsFromTitle <= 6) {
    return { mult: 1.10, context: "briga pelo título" };
  }

  if (midTable && isLateSeaon) {
    return { mult: 0.95, context: "meio de tabela tardio" };
  }

  return { mult: 1.0, context: "jogo regular" };
}

/** Season stage multiplier for expected goals */
function seasonStageMultiplier(matchweek: number, totalMatchweeks: number): number {
  const progress = matchweek / totalMatchweeks;
  // Early season (first 20%): teams feel each other out → slightly fewer goals
  if (progress < 0.20) return 0.94;
  // Late season (last 20%): fatigue + high stakes → can go either way
  if (progress > 0.80) return 1.04;
  // Peak season: normal
  return 1.0;
}

/** H2H analysis */
function analyzeH2H(matches: PastMatch[]): {
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  avgTotalGoals: number;
  mostCommonScores: Array<{ home: number; away: number; count: number }>;
  recurrenceFactor: number;
} {
  if (matches.length === 0) {
    return {
      homeWinRate: 0.44,
      drawRate: 0.27,
      awayWinRate: 0.29,
      avgTotalGoals: 2.65,
      mostCommonScores: [],
      recurrenceFactor: 1.0,
    };
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalGoalsSum = 0;
  const scoreCounts: Record<string, { home: number; away: number; count: number }> = {};

  for (const m of matches) {
    const hg = m.goalsFor;
    const ag = m.goalsAgainst;
    totalGoalsSum += hg + ag;
    if (hg > ag) homeWins++;
    else if (hg === ag) draws++;
    else awayWins++;

    const key = `${hg}-${ag}`;
    if (!scoreCounts[key]) scoreCounts[key] = { home: hg, away: ag, count: 0 };
    scoreCounts[key].count++;
  }

  const n = matches.length;
  const mostCommonScores = Object.values(scoreCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Recurrence factor: if top H2H score appears 3+ times → boost that line's probability
  const topScore = mostCommonScores[0];
  const recurrenceFactor = topScore && topScore.count >= 3
    ? 1.0 + (topScore.count - 2) * 0.08
    : 1.0;

  return {
    homeWinRate: homeWins / n,
    drawRate: draws / n,
    awayWinRate: awayWins / n,
    avgTotalGoals: totalGoalsSum / n,
    mostCommonScores,
    recurrenceFactor,
  };
}

export function computeContextualFactors(input: ContextualInput): ContextualResult {
  const {
    attendanceRatio = 0.85,
    isNeutralVenue = false,
    homeTablePosition = 10,
    awayTablePosition = 10,
    totalTeamsInLeague = 20,
    homePointsFromSafety = 10,
    awayPointsFromSafety = 10,
    homePointsFromTitle = 20,
    awayPointsFromTitle = 20,
    matchweek = 20,
    totalMatchweeks = 38,
    h2hMatches = [],
    isDecider = false,
  } = input;

  // Dynamic home advantage
  const haResult = dynamicHomeAdv(attendanceRatio, isNeutralVenue);

  // Motivation
  const homeMot = motivationMultiplier(
    homeTablePosition, totalTeamsInLeague,
    homePointsFromSafety, homePointsFromTitle,
    matchweek, totalMatchweeks, isDecider,
  );
  const awayMot = motivationMultiplier(
    awayTablePosition, totalTeamsInLeague,
    awayPointsFromSafety, awayPointsFromTitle,
    matchweek, totalMatchweeks, isDecider,
  );

  // Season stage
  const seasonMult = seasonStageMultiplier(matchweek, totalMatchweeks);

  // H2H analysis
  const h2hData = analyzeH2H(h2hMatches);

  // Combine motivation contexts
  const motivContext = [homeMot.context, awayMot.context]
    .filter((c) => c !== "jogo regular")
    .join(" vs ") || "jogo regular";

  return {
    dynamicHomeAdvantage: haResult.multiplier,
    homeMotivationMult: homeMot.mult,
    awayMotivationMult: awayMot.mult,
    seasonStageMultiplier: seasonMult,
    h2hHomeWinRate: h2hData.homeWinRate,
    h2hDrawRate: h2hData.drawRate,
    h2hAwayWinRate: h2hData.awayWinRate,
    h2hAvgTotalGoals: h2hData.avgTotalGoals,
    h2hMostCommonScores: h2hData.mostCommonScores,
    h2hScorelineRecurrenceFactor: h2hData.recurrenceFactor,
    isDeciderMatch: isDecider,
    motivationContext: motivContext,
    crowdEffect: haResult.description,
  };
}
