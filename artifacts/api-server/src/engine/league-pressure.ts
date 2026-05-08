/**
 * League Pressure, Derby Factor & Competition Importance Index.
 *
 * Three contextual adjustments derived from team form/results:
 *
 * 1. LEAGUE TABLE PRESSURE INDEX
 *    Approximated from recent W/D/L record — teams in bad form (likely relegation zone)
 *    or very good form (title race) play with different intensity and tactical setup.
 *    - Relegation pressure: erratic, desperate play → higher variance, more goals
 *    - Title race: focused, conservative play → fewer goals, more draw-seeking
 *    - Nothing-to-play-for (mid-table, late season): reduced intensity → fewer goals
 *
 * 2. DERBY/RIVALRY FACTOR
 *    Local derbies have systematically different score distributions vs normal games:
 *    - More draws (rivalries are tight)
 *    - Lower scoring (both teams prioritize not losing)
 *    - Higher emotional volatility (red cards, penalties, late goals)
 *    Approximated from H2H draw rate and goal totals.
 *
 * 3. COMEBACK RATE / MENTAL RESILIENCE
 *    Teams that frequently come back from losing positions are "mentally strong"
 *    and their scoring late in games is underrepresented in simple form models.
 *    Estimated from matches where team scored more goals in games where they conceded first
 *    (approximated from trailing→win or trailing→draw patterns in score data).
 *
 * 4. MOMENTUM CARRY (rolling 3-game weighted)
 *    Short-window aggressive weighting of the last 3 games' goal output.
 *    Captures hot/cold streaks that the xi-decay form model responds to slowly.
 *
 * References:
 *   Dobson & Goddard (2010) "The Economics of Football" Cambridge UP.
 *   Dowie (1982) "Why Spain should win the World Cup". New Scientist 94:693-695.
 *   Barnett & Hilditch (1993) "Effect of an artificial pitch surface on home team
 *   performance in football". JRSS-A 156(1):39-50.
 */

import type { PastMatch } from "./weighted-form";

export interface LeaguePressureResult {
  /** 0 = neutral, positive = high-pressure (title or relegation), negative = apathy */
  pressureIndex: number;
  /** Estimated table zone based on form: "title" | "upper" | "mid" | "lower" | "relegation" */
  estimatedZone: "title" | "upper" | "mid" | "lower" | "relegation";
  /** Lambda adjustment from table pressure */
  pressureLambdaAdj: number;
  /** Variance inflation from pressure (adds to NegBin alpha / zip pi) */
  varianceInflation: number;
}

export interface DerbyFactorResult {
  /** Whether this match qualifies as a derby (H2H draw rate >= 35% or avg goals < 2.0) */
  isDerby: boolean;
  /** Draw rate from H2H */
  h2hDrawRate: number;
  /** Average total goals in H2H */
  h2hAvgGoals: number;
  /** Lambda multiplier: < 1 in derbies (fewer goals) */
  lambdaAdj: number;
  /** Draw probability boost for derby */
  drawBoost: number;
}

export interface MomentumCarryResult {
  /** Momentum score: > 1 = hot streak, < 1 = cold streak */
  momentumScore: number;
  /** Lambda multiplier */
  lambdaAdj: number;
  /** Trend label */
  label: string;
}

export interface ResilienceResult {
  /** Estimated comeback rate (0–1): fraction of adverse games where team recovered */
  comebackRate: number;
  /** Late-game scoring boost (for Markov live model) */
  lateGameBoost: number;
  /** Whether this team is a "resilient scorer" */
  isResilient: boolean;
}

// ── League Pressure ───────────────────────────────────────────────────────────

function recentWDL(history: PastMatch[], n: number): { wins: number; draws: number; losses: number } {
  const recent = history.slice(0, n);
  let wins = 0, draws = 0, losses = 0;
  for (const m of recent) {
    if (m.goalsFor > m.goalsAgainst) wins++;
    else if (m.goalsFor === m.goalsAgainst) draws++;
    else losses++;
  }
  return { wins, draws, losses };
}

export function computeLeaguePressure(history: PastMatch[]): LeaguePressureResult {
  if (history.length < 5) {
    return {
      pressureIndex: 0,
      estimatedZone: "mid",
      pressureLambdaAdj: 1.0,
      varianceInflation: 0,
    };
  }

  const { wins, draws, losses } = recentWDL(history, 7);
  const total = wins + draws + losses || 1;
  const ppg = (wins * 3 + draws) / total;
  // Expected PPG: 1.5 for mid-table, 2.2 for title, 0.8 for relegation
  const pressureIndex = ppg - 1.5; // centered on mid-table

  let estimatedZone: LeaguePressureResult["estimatedZone"];
  let pressureLambdaAdj: number;
  let varianceInflation: number;

  if (ppg >= 2.2) {
    estimatedZone = "title";
    // Title contenders: focused, controlled → slightly fewer goals but consistent
    pressureLambdaAdj = 0.97;
    varianceInflation = -0.02;
  } else if (ppg >= 1.8) {
    estimatedZone = "upper";
    pressureLambdaAdj = 1.00;
    varianceInflation = 0;
  } else if (ppg >= 1.2) {
    estimatedZone = "mid";
    // Mid-table apathy: may underperform
    pressureLambdaAdj = 0.97;
    varianceInflation = 0.01;
  } else if (ppg >= 0.7) {
    estimatedZone = "lower";
    // Lower-table struggle: desperate but erratic
    pressureLambdaAdj = 1.03;
    varianceInflation = 0.04;
  } else {
    estimatedZone = "relegation";
    // Relegation crisis: desperate, more all-out attack, more errors
    pressureLambdaAdj = 1.06;
    varianceInflation = 0.07;
  }

  return { pressureIndex, estimatedZone, pressureLambdaAdj, varianceInflation };
}

// ── Derby Factor ──────────────────────────────────────────────────────────────

export function computeDerbyFactor(
  h2hHistory: PastMatch[],
  avgLeagueGoals: number = 2.70, // avg total goals per game
): DerbyFactorResult {
  if (h2hHistory.length < 3) {
    return {
      isDerby: false,
      h2hDrawRate: 0,
      h2hAvgGoals: avgLeagueGoals,
      lambdaAdj: 1.0,
      drawBoost: 0,
    };
  }

  const draws = h2hHistory.filter((m) => m.goalsFor === m.goalsAgainst).length;
  const h2hDrawRate = draws / h2hHistory.length;
  const h2hAvgGoals = h2hHistory.reduce((s, m) => s + m.goalsFor + m.goalsAgainst, 0) / h2hHistory.length;

  // Derby conditions: ≥35% draw rate OR avg total goals < 2.0 (very tight matchups)
  const isDerby = h2hDrawRate >= 0.35 || h2hAvgGoals < 2.0;

  let lambdaAdj = 1.0;
  let drawBoost = 0;

  if (isDerby) {
    // Derby effect: fewer goals, more draws
    const goalsRatio = h2hAvgGoals / avgLeagueGoals;
    lambdaAdj = Math.max(0.88, Math.min(0.99, 0.88 + goalsRatio * 0.15));
    drawBoost = Math.max(0, Math.min(0.08, (h2hDrawRate - 0.25) * 0.4));
  }

  return { isDerby, h2hDrawRate, h2hAvgGoals, lambdaAdj, drawBoost };
}

// ── Momentum Carry ────────────────────────────────────────────────────────────

export function computeMomentumCarry(history: PastMatch[]): MomentumCarryResult {
  if (history.length < 3) {
    return { momentumScore: 1.0, lambdaAdj: 1.0, label: "neutro" };
  }

  // Heavily weight last 3 games
  const last3 = history.slice(0, 3);
  const last7 = history.slice(0, 7);

  const avg3For = last3.reduce((s, m) => s + m.goalsFor, 0) / 3;
  const avg7For = last7.length > 0
    ? last7.reduce((s, m) => s + m.goalsFor, 0) / last7.length
    : avg3For;

  const momentumScore = avg7For > 0.01 ? avg3For / avg7For : 1.0;

  // Lambda adjustment from momentum carry
  // Hot (momentumScore > 1.2): team scoring 20%+ more than their baseline recently
  // Cold (momentumScore < 0.8): team scoring 20%+ less than baseline recently
  const lambdaAdj = Math.max(0.92, Math.min(1.08,
    1.0 + 0.08 * Math.tanh((momentumScore - 1.0) * 3),
  ));

  const label =
    momentumScore >= 1.35 ? "momentum muito forte" :
    momentumScore >= 1.15 ? "momentum positivo" :
    momentumScore >= 0.85 ? "neutro" :
    momentumScore >= 0.65 ? "momentum negativo" :
    "quebra de confiança";

  return { momentumScore, lambdaAdj, label };
}

// ── Resilience / Comeback Rate ────────────────────────────────────────────────

export function computeResilience(history: PastMatch[]): ResilienceResult {
  if (history.length < 5) {
    return { comebackRate: 0.3, lateGameBoost: 1.0, isResilient: false };
  }

  // Proxy: games where team conceded but still won or drew = comeback/resilience signal
  // goalsFor >= goalsAgainst AND goalsAgainst > 0 → didn't let conceding stop them
  const challengedGames = history.filter((m) => m.goalsAgainst > 0);
  const recoveries = challengedGames.filter((m) => m.goalsFor >= m.goalsAgainst);
  const comebackRate = challengedGames.length > 0 ? recoveries.length / challengedGames.length : 0.3;

  const isResilient = comebackRate >= 0.55;
  // Resilient teams score more in the second half / late game
  const lateGameBoost = isResilient ? 1.04 : 1.0;

  return { comebackRate, lateGameBoost, isResilient };
}
