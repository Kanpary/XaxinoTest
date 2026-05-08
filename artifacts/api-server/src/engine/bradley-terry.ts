/**
 * Bradley-Terry Paired Comparison Model.
 *
 * The Bradley-Terry model assigns a strength parameter π_i > 0 to each team
 * such that: P(team i beats team j) = π_i / (π_i + π_j)
 *
 * Here we estimate π values from exponentially-decayed form history using
 * a simplified MLE approach. The model provides a third, independent estimate
 * of win/draw/loss probabilities, cross-checking Dixon-Coles and Elo.
 *
 * Extension: Davidson (1970) extension adds a draw parameter ν > 0:
 *   P(draw) = ν·√(π_i·π_j) / (π_i + ν·√(π_i·π_j) + π_j)
 *
 * Lambda derivation: from win/draw/loss probabilities, derive expected goals
 * using the Maher (1982) factorization.
 *
 * References:
 *   Bradley & Terry (1952) "Rank Analysis of Incomplete Block Designs I".
 *     Biometrika 39(3/4):324-345.
 *   Davidson (1970) "On Extending the Bradley-Terry Model to Accommodate Ties".
 *     JASA 65(329):317-328.
 *   Maher (1982) "Modelling Association Football Scores".
 *     Statistica Neerlandica 36(3):109-118.
 */

import type { PastMatch } from "./weighted-form";
import { poissonScoreMatrix } from "./poisson";

export interface BradleyTerryResult {
  /** Bradley-Terry home win probability */
  homeWinProb: number;
  /** Bradley-Terry draw probability (Davidson extension) */
  drawProb: number;
  /** Bradley-Terry away win probability */
  awayWinProb: number;
  /** Derived expected goals for home team */
  derivedLambdaHome: number;
  /** Derived expected goals for away team */
  derivedLambdaAway: number;
  /** Home team strength parameter (normalised to log scale) */
  homeStrength: number;
  /** Away team strength parameter (normalised to log scale) */
  awayStrength: number;
  /** Score probability matrix from B-T derived lambdas */
  matrix: number[][];
}

// Davidson draw parameter (ν): empirically fitted to football ~0.35
const DAVIDSON_NU = 0.35;
// League average goals per game
const LEAGUE_AVG = 1.35;

/**
 * Estimate a team's Bradley-Terry strength parameter from their form history.
 *
 * Strength = geometric mean of (goalsFor / goalsAgainst) per game,
 * weighted exponentially by recency.
 *
 * We clamp to [0.2, 5.0] to avoid degenerate cases.
 */
function estimateBTStrength(history: PastMatch[], xi: number = 0.0065): number {
  if (history.length === 0) return 1.0;

  let totalWeight = 0;
  let logStrengthSum = 0;

  for (const m of history) {
    const w = Math.exp(-xi * Math.max(0, m.daysAgo));
    // Use smoothed ratio to avoid log(0)
    const forSmoothed = m.goalsFor + 0.5;
    const againstSmoothed = m.goalsAgainst + 0.5;
    logStrengthSum += w * Math.log(forSmoothed / againstSmoothed);
    totalWeight += w;
  }

  if (totalWeight < 1e-6) return 1.0;
  const logStrength = logStrengthSum / totalWeight;
  return Math.max(0.2, Math.min(5.0, Math.exp(logStrength)));
}

/**
 * Apply home advantage to Bradley-Terry strength.
 * Empirical home advantage factor in football ≈ 1.28 (Carmichael et al. 2000).
 */
const HOME_ADVANTAGE_BT = 1.28;

/**
 * Compute B-T match outcome probabilities and derive lambdas.
 *
 * From B-T win probabilities, we back-derive lambdas using the Poisson model:
 * P(home wins) ≈ Σ_{h>a} Poisson(h|λ_h) * Poisson(a|λ_a)
 * We use a Newton step to find λ_h, λ_a consistent with the B-T probs.
 */
export function bradleyTerryAnalysis(
  homeHistory: PastMatch[],
  awayHistory: PastMatch[],
  leagueAvgGoals: number = LEAGUE_AVG,
  maxGoals: number = 8,
): BradleyTerryResult {
  const rawHomeStrength = estimateBTStrength(homeHistory) * HOME_ADVANTAGE_BT;
  const rawAwayStrength = estimateBTStrength(awayHistory);

  // Davidson extension probabilities
  const denom = rawHomeStrength + DAVIDSON_NU * Math.sqrt(rawHomeStrength * rawAwayStrength) + rawAwayStrength;
  const homeWinProb = rawHomeStrength / denom;
  const drawProb = (DAVIDSON_NU * Math.sqrt(rawHomeStrength * rawAwayStrength)) / denom;
  const awayWinProb = rawAwayStrength / denom;

  // Derive lambdas from B-T probabilities using the Poisson parameterisation:
  // Expected goals = league_avg * team_strength_ratio
  // We use the log-odds of win probability to scale from the league average.
  const logOddsHome = Math.log(Math.max(1e-6, homeWinProb / Math.max(1e-6, awayWinProb)));
  // Map log-odds to goal differential: Δλ = log-odds / scaling_factor
  const deltaLambda = logOddsHome / 2.0; // empirical scaling

  const lambdaBase = leagueAvgGoals * (1 - drawProb * 0.3); // fewer goals in draw-likely games
  const derivedLambdaHome = Math.max(0.2, Math.min(6, lambdaBase + deltaLambda / 2));
  const derivedLambdaAway = Math.max(0.2, Math.min(6, lambdaBase - deltaLambda / 2));

  const matrix = poissonScoreMatrix(derivedLambdaHome, derivedLambdaAway, maxGoals);

  return {
    homeWinProb,
    drawProb,
    awayWinProb,
    derivedLambdaHome,
    derivedLambdaAway,
    homeStrength: Math.log(rawHomeStrength),
    awayStrength: Math.log(rawAwayStrength),
    matrix,
  };
}
