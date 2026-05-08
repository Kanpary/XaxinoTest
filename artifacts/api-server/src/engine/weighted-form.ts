/**
 * Exponentially-weighted form calculator.
 * Implements Dixon-Coles time-decay weight w(t) = exp(-xi * days_ago).
 *
 * Precision improvements:
 * - Bayesian shrinkage pseudo-count = 8 for stability with small samples
 * - Venue-adjusted neutralization: remove home/away bias from combined form
 * - computeVenueSplitForm: computes home-context and away-context form separately
 *   for better prediction accuracy when teams play a home/away game
 * - Soft clipping on attack/defense strengths raised to [0.4, 3.0] to allow
 *   genuine outlier teams (relegation/top-tier) to be expressed
 * - Lambda ceiling in strengthsToLambdas raised to 8 (was 6) — allows projection
 *   of genuinely high-scoring matchups without artificial truncation
 *
 * Extended metrics (v2):
 * - cleanSheetRate: fraction of recent matches where team conceded 0 goals
 * - failedToScoreRate: fraction of recent matches where team scored 0 goals
 * - formTrend: WLS slope of goals scored vs time (+1 = rapidly improving, -1 = declining)
 * - scoringConsistency: 1 - CV_goals, normalised [0,1] (1 = very consistent scorer)
 * - goalVariance: raw variance of goals scored per game
 * - concededVariance: raw variance of goals conceded per game
 */

export interface PastMatch {
  daysAgo: number;
  goalsFor: number;
  goalsAgainst: number;
  isHome: boolean;
}

export interface WeightedFormResult {
  attackStrength: number;        // ratio vs league average for-goals
  defenseStrength: number;       // ratio vs league average against-goals
  rawAvgFor: number;
  rawAvgAgainst: number;
  effectiveSampleSize: number;
  /** Fraction of matches with 0 goals conceded (0..1) */
  cleanSheetRate: number;
  /** Fraction of matches with 0 goals scored (0..1) */
  failedToScoreRate: number;
  /**
   * Linear trend of goals scored over time (WLS).
   * Positive (+) = team is scoring MORE in recent games (improving).
   * Negative (−) = team is scoring LESS recently (declining).
   * Range: [−1, +1] normalised. Values beyond ±0.3 are practically significant.
   */
  formTrend: number;
  /**
   * Scoring consistency index [0..1].
   * 1 = very consistent scorer (low variance).
   * 0 = highly erratic (high variance relative to mean).
   */
  scoringConsistency: number;
  /** Raw variance of goals scored per game */
  goalVariance: number;
  /** Raw variance of goals conceded per game */
  concededVariance: number;
}

const LEAGUE_AVG_GOALS = 1.35; // per team per match

/**
 * HOME_ADJ: average goals scored at home is ~15% higher than neutral/away.
 * Used to neutralise venue effect before computing attack/defense strengths.
 */
const HOME_ADJ = 1.15;

// ── Form trend: WLS slope of goals scored vs time ───────────────────────────

/**
 * Weighted Least Squares trend of goals scored over time.
 *
 * Time variable = daysAgo (small = more recent).
 * Weights = exp(-xi * daysAgo) (same decay as form model).
 *
 * WLS slope: b = (W·Σwt·g − Σwt·Σwg) / (W·Σwt² − (Σwt)²)
 *
 * Negative slope = fewer goals as daysAgo increases = improving recently.
 * We return −slope so positive = improving, normalised to [−1, +1].
 * Normalisation: 0.10 goals/day ≈ scoring 3 extra goals over 30 days.
 */
function computeFormTrend(matches: PastMatch[], xi: number): number {
  if (matches.length < 3) return 0;

  let sumW = 0, sumWt = 0, sumWg = 0, sumWt2 = 0, sumWtg = 0;
  for (const m of matches) {
    const w = Math.exp(-xi * Math.max(0, m.daysAgo));
    const t = m.daysAgo;
    const g = m.goalsFor;
    sumW += w;
    sumWt += w * t;
    sumWg += w * g;
    sumWt2 += w * t * t;
    sumWtg += w * t * g;
  }

  const denom = sumW * sumWt2 - sumWt * sumWt;
  if (Math.abs(denom) < 1e-10) return 0;
  const slope = (sumW * sumWtg - sumWt * sumWg) / denom;
  return Math.max(-1, Math.min(1, -slope / 0.10));
}

// ── Scoring consistency: 1 − CV / CV_max ─────────────────────────────────────

/**
 * CV (coefficient of variation) = σ / μ.
 * CV_max = 1.6: maps the typical football range to [0,1].
 *   CV = 0   → consistency = 1.00  (impossible without scoring 0 in every game)
 *   CV ≈ 0.8 → consistency ≈ 0.50  (typical football)
 *   CV ≥ 1.6 → consistency = 0.00  (extremely erratic)
 */
function computeScoringConsistency(goals: number[], mean: number): number {
  if (goals.length < 3 || mean < 0.01) return 0.5;
  const variance = goals.reduce((s, g) => s + (g - mean) ** 2, 0) / goals.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(1, 1 - cv / 1.6));
}

// ── Core computation helpers ──────────────────────────────────────────────────

interface RawStats {
  totalWeight: number;
  weightedFor: number;
  weightedAgainst: number;
  cleanSheets: number;
  failedToScore: number;
  goalsArray: number[];
  concededArray: number[];
}

function gatherRawStats(matches: PastMatch[], xi: number): RawStats {
  let totalWeight = 0, weightedFor = 0, weightedAgainst = 0;
  let cleanSheets = 0, failedToScore = 0;
  const goalsArray: number[] = [];
  const concededArray: number[] = [];
  for (const m of matches) {
    const w = Math.exp(-xi * Math.max(0, m.daysAgo));
    weightedFor += w * m.goalsFor;
    weightedAgainst += w * m.goalsAgainst;
    totalWeight += w;
    if (m.goalsAgainst === 0) cleanSheets++;
    if (m.goalsFor === 0) failedToScore++;
    goalsArray.push(m.goalsFor);
    concededArray.push(m.goalsAgainst);
  }
  return { totalWeight, weightedFor, weightedAgainst, cleanSheets, failedToScore, goalsArray, concededArray };
}

function buildResultFromStats(
  matches: PastMatch[],
  xi: number,
  stats: RawStats,
): WeightedFormResult {
  const pseudo = 8;
  const clip = (v: number) => Math.max(0.4, Math.min(3.0, v));
  const n = matches.length;

  const shrunkFor = (stats.weightedFor + pseudo * LEAGUE_AVG_GOALS) / (stats.totalWeight + pseudo);
  const shrunkAgainst = (stats.weightedAgainst + pseudo * LEAGUE_AVG_GOALS) / (stats.totalWeight + pseudo);

  const rawMeanFor = stats.goalsArray.reduce((s, g) => s + g, 0) / Math.max(1, stats.goalsArray.length);
  const rawMeanConceded = stats.concededArray.reduce((s, g) => s + g, 0) / Math.max(1, stats.concededArray.length);

  const goalVariance = stats.goalsArray.reduce((s, g) => s + (g - rawMeanFor) ** 2, 0) / Math.max(1, stats.goalsArray.length);
  const concededVariance = stats.concededArray.reduce((s, g) => s + (g - rawMeanConceded) ** 2, 0) / Math.max(1, stats.concededArray.length);

  return {
    attackStrength: clip(shrunkFor / LEAGUE_AVG_GOALS),
    defenseStrength: clip(shrunkAgainst / LEAGUE_AVG_GOALS),
    rawAvgFor: stats.weightedFor / stats.totalWeight,
    rawAvgAgainst: stats.weightedAgainst / stats.totalWeight,
    effectiveSampleSize: stats.totalWeight,
    cleanSheetRate: n > 0 ? stats.cleanSheets / n : 0,
    failedToScoreRate: n > 0 ? stats.failedToScore / n : 0,
    formTrend: computeFormTrend(matches, xi),
    scoringConsistency: computeScoringConsistency(stats.goalsArray, rawMeanFor),
    goalVariance,
    concededVariance,
  };
}

const EMPTY_FORM: WeightedFormResult = {
  attackStrength: 1, defenseStrength: 1,
  rawAvgFor: LEAGUE_AVG_GOALS, rawAvgAgainst: LEAGUE_AVG_GOALS,
  effectiveSampleSize: 0, cleanSheetRate: 0, failedToScoreRate: 0,
  formTrend: 0, scoringConsistency: 0.5, goalVariance: 0, concededVariance: 0,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function computeWeightedForm(
  matches: PastMatch[],
  xi: number = 0.0065,
): WeightedFormResult {
  if (matches.length === 0) return { ...EMPTY_FORM };

  // Gather stats with venue neutralisation applied to the weighted sums
  let totalWeight = 0, weightedFor = 0, weightedAgainst = 0;
  let cleanSheets = 0, failedToScore = 0;
  const goalsArray: number[] = [];
  const concededArray: number[] = [];

  for (const m of matches) {
    const w = Math.exp(-xi * Math.max(0, m.daysAgo));
    // Venue-neutralise: home goals are inflated, away are deflated
    const venueAdjFor = m.isHome ? 1 / HOME_ADJ : HOME_ADJ;
    const venueAdjAgainst = m.isHome ? HOME_ADJ : 1 / HOME_ADJ;
    weightedFor += w * m.goalsFor * venueAdjFor;
    weightedAgainst += w * m.goalsAgainst * venueAdjAgainst;
    totalWeight += w;
    if (m.goalsAgainst === 0) cleanSheets++;
    if (m.goalsFor === 0) failedToScore++;
    goalsArray.push(m.goalsFor);
    concededArray.push(m.goalsAgainst);
  }

  if (totalWeight === 0) return { ...EMPTY_FORM };

  const stats: RawStats = { totalWeight, weightedFor, weightedAgainst, cleanSheets, failedToScore, goalsArray, concededArray };
  return buildResultFromStats(matches, xi, stats);
}

/**
 * Internal: compute weighted form WITHOUT venue neutralization.
 * Used for venue-split form where all matches share the same venue context.
 */
function computeRawWeightedForm(matches: PastMatch[], xi: number): WeightedFormResult {
  if (matches.length === 0) return { ...EMPTY_FORM };
  const stats = gatherRawStats(matches, xi);
  if (stats.totalWeight === 0) return { ...EMPTY_FORM };
  return buildResultFromStats(matches, xi, stats);
}

/**
 * Venue-split form computation.
 *
 * Separates match history into home-only and away-only subsets.
 * Home team form computed from home games (no venue adj needed).
 * Away team form computed from away games (no venue adj needed).
 */
export interface VenueSplitForm {
  homeCtx: WeightedFormResult;
  awayCtx: WeightedFormResult;
  homeSampleSize: number;
  awaySampleSize: number;
}

export function computeVenueSplitForm(
  matches: PastMatch[],
  xi: number = 0.0065,
): VenueSplitForm {
  const homeMatches = matches.filter((m) => m.isHome);
  const awayMatches = matches.filter((m) => !m.isHome);
  return {
    homeCtx: computeRawWeightedForm(homeMatches, xi),
    awayCtx: computeRawWeightedForm(awayMatches, xi),
    homeSampleSize: homeMatches.length,
    awaySampleSize: awayMatches.length,
  };
}

/**
 * Compute lambdas for the upcoming match based on attack/defense strengths.
 *   lambdaHome = leagueAvg * homeAttack * awayDefense * exp(homeAdvantage)
 *   lambdaAway = leagueAvg * awayAttack * homeDefense / exp(homeAdvantage)
 */
export function strengthsToLambdas(
  homeAttack: number,
  homeDefense: number,
  awayAttack: number,
  awayDefense: number,
  homeAdvantage: number = 0.22,
  leagueAvgGoals: number = LEAGUE_AVG_GOALS,
): { lambdaHome: number; lambdaAway: number } {
  const haMult = Math.exp(homeAdvantage);
  const lambdaHome = leagueAvgGoals * homeAttack * awayDefense * haMult;
  const lambdaAway = (leagueAvgGoals * awayAttack * homeDefense) / haMult;
  return {
    lambdaHome: Math.max(0.1, Math.min(8, lambdaHome)),
    lambdaAway: Math.max(0.1, Math.min(8, lambdaAway)),
  };
}

export function recentFormString(matches: PastMatch[]): string[] {
  return matches
    .slice(0, 5)
    .map((m) =>
      m.goalsFor > m.goalsAgainst ? "V"
        : m.goalsFor === m.goalsAgainst ? "E"
        : "D",
    );
}
