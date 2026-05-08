/**
 * Markov chain for live and pre-match goal projection.
 *
 * Improvements:
 * - For live games: uses remaining time fraction and current score to compute
 *   full final-score probability distribution (not just expected goals).
 * - Bayesian score-state prior: conditions on current scoreline, adjusting
 *   the team's intensity based on game situation (losing teams attack more).
 * - Momentum multipliers: small empirical adjustments for game state.
 * - Pre-match: returns expected goals = lambda (unchanged, equilibrium).
 *
 * References:
 *   Dixon & Robinson (1998) "A birth process model for association football matches".
 *   The Statistician 47(3):523-538.
 */

export interface MarkovInput {
  lambdaHome: number;
  lambdaAway: number;
  minutesElapsed?: number; // for live; 0 or undefined if pre-match
  currentHome?: number;
  currentAway?: number;
}

export interface MarkovResult {
  projectedHome: number;
  projectedAway: number;
  /** Probability distribution of final score differences (remaining goals only) */
  remainingGoalProbs?: { home: number; away: number; prob: number }[];
  /** Probability that home team wins from this state */
  homeWinProb?: number;
  /** Probability of draw */
  drawProb?: number;
  /** Probability that away team wins from this state */
  awayWinProb?: number;
  /** Estimated remaining goals */
  remainingGoalsHome: number;
  remainingGoalsAway: number;
}

/**
 * Situational intensity multipliers — teams who are losing attack harder.
 * Based on Dixon & Robinson (1998) empirical estimates.
 */
function situationalMultipliers(
  homeScore: number,
  awayScore: number,
  minutesElapsed: number,
): { home: number; away: number } {
  const diff = homeScore - awayScore;
  const urgency = minutesElapsed > 60 ? 1.2 : 1.0; // late game = more urgency

  let homeMult = 1.0;
  let awayMult = 1.0;

  if (diff < 0) {
    // Home losing: attacks harder
    homeMult = urgency * (1.0 + 0.12 * Math.min(2, Math.abs(diff)));
    awayMult = urgency * 0.95; // away winning: slightly more cautious
  } else if (diff > 0) {
    // Home winning: away team presses
    awayMult = urgency * (1.0 + 0.10 * Math.min(2, diff));
    homeMult = urgency * 0.97; // home leading: protect slightly
  }

  return { home: homeMult, away: awayMult };
}

const MAX_GOALS_PER_TEAM = 7;

function poissonPmf(lambda: number, k: number): number {
  if (k < 0 || !Number.isFinite(lambda) || lambda <= 0) return k === 0 ? 1 : 0;
  let log_p = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) log_p -= Math.log(i);
  return Math.exp(log_p);
}

/**
 * Compute remaining-goals score distribution using Poisson assumption
 * for remaining time, conditioned on current score.
 */
function computeRemainingDistribution(
  lambdaRemHome: number,
  lambdaRemAway: number,
): { home: number; away: number; prob: number }[] {
  const cells: { home: number; away: number; prob: number }[] = [];
  for (let h = 0; h <= MAX_GOALS_PER_TEAM; h++) {
    for (let a = 0; a <= MAX_GOALS_PER_TEAM; a++) {
      const prob = poissonPmf(lambdaRemHome, h) * poissonPmf(lambdaRemAway, a);
      if (prob > 1e-6) cells.push({ home: h, away: a, prob });
    }
  }
  return cells;
}

export function markovProjectedFinal(input: MarkovInput): MarkovResult {
  const elapsed = input.minutesElapsed ?? 0;
  const currentHome = input.currentHome ?? 0;
  const currentAway = input.currentAway ?? 0;

  const remainingFrac = Math.max(0, 90 - elapsed) / 90;

  if (remainingFrac < 0.01) {
    // Game essentially over
    return {
      projectedHome: currentHome,
      projectedAway: currentAway,
      remainingGoalsHome: 0,
      remainingGoalsAway: 0,
      homeWinProb: currentHome > currentAway ? 1 : 0,
      drawProb: currentHome === currentAway ? 1 : 0,
      awayWinProb: currentAway > currentHome ? 1 : 0,
    };
  }

  // Apply situational multipliers for live games
  const sitMult = elapsed > 0
    ? situationalMultipliers(currentHome, currentAway, elapsed)
    : { home: 1.0, away: 1.0 };

  const lambdaRemHome = Math.max(0.01, input.lambdaHome * remainingFrac * sitMult.home);
  const lambdaRemAway = Math.max(0.01, input.lambdaAway * remainingFrac * sitMult.away);

  // For live games, compute the full remaining-goals distribution
  const remainingDist = elapsed > 0
    ? computeRemainingDistribution(lambdaRemHome, lambdaRemAway)
    : undefined;

  // Win/draw/loss probabilities from current state
  let homeWinProb: number | undefined;
  let drawProb: number | undefined;
  let awayWinProb: number | undefined;

  if (remainingDist) {
    let hw = 0, d = 0, aw = 0;
    for (const cell of remainingDist) {
      const finalHome = currentHome + cell.home;
      const finalAway = currentAway + cell.away;
      if (finalHome > finalAway) hw += cell.prob;
      else if (finalHome === finalAway) d += cell.prob;
      else aw += cell.prob;
    }
    const total = hw + d + aw || 1;
    homeWinProb = hw / total;
    drawProb = d / total;
    awayWinProb = aw / total;
  }

  const projectedHome = currentHome + lambdaRemHome;
  const projectedAway = currentAway + lambdaRemAway;

  return {
    projectedHome,
    projectedAway,
    remainingGoalProbs: remainingDist,
    homeWinProb,
    drawProb,
    awayWinProb,
    remainingGoalsHome: lambdaRemHome,
    remainingGoalsAway: lambdaRemAway,
  };
}
