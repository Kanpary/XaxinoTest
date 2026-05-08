/**
 * Elo ratings with goal-difference adjustment (used by FIFA, ClubElo, et al.).
 * Updated after every observed match. Used to derive lambda_home / lambda_away
 * via a logistic-to-Poisson conversion when team form data is sparse.
 */

const K_BASE = 20;

export interface EloUpdateInput {
  homeRating: number;
  awayRating: number;
  homeGoals: number;
  awayGoals: number;
  homeAdvantage?: number;
}

export interface EloUpdateOutput {
  newHomeRating: number;
  newAwayRating: number;
  expectedHome: number;
}

export function expectedScore(
  ratingA: number,
  ratingB: number,
  homeAdvantage: number = 65,
): number {
  return 1 / (1 + Math.pow(10, (ratingB - (ratingA + homeAdvantage)) / 400));
}

export function eloUpdate(input: EloUpdateInput): EloUpdateOutput {
  const ha = input.homeAdvantage ?? 65;
  const exp = expectedScore(input.homeRating, input.awayRating, ha);
  const diff = input.homeGoals - input.awayGoals;
  const actual = diff > 0 ? 1 : diff === 0 ? 0.5 : 0;
  // Goal-difference K multiplier (ClubElo-style)
  const absDiff = Math.abs(diff);
  let kMult = 1;
  if (absDiff === 2) kMult = 1.5;
  else if (absDiff >= 3) kMult = (11 + absDiff) / 8;
  const k = K_BASE * kMult;
  const delta = k * (actual - exp);
  return {
    newHomeRating: input.homeRating + delta,
    newAwayRating: input.awayRating - delta,
    expectedHome: exp,
  };
}

/**
 * Convert an Elo rating differential to expected goals lambdas.
 * Calibrated against historical Premier League average (avg goals ~2.7).
 */
export function eloToLambdas(
  homeRating: number,
  awayRating: number,
  leagueAvgGoals: number = 2.7,
  homeAdvantage: number = 65,
): { lambdaHome: number; lambdaAway: number } {
  const exp = expectedScore(homeRating, awayRating, homeAdvantage);
  // Map expectation [0..1] to a goal-share factor.
  // Strong favorite (exp=0.8) gets ~65% of total goals on average.
  const homeShare = 0.5 + (exp - 0.5) * 0.35;
  const lambdaHome = leagueAvgGoals * homeShare;
  const lambdaAway = leagueAvgGoals * (1 - homeShare);
  return {
    lambdaHome: Math.max(0.05, lambdaHome),
    lambdaAway: Math.max(0.05, lambdaAway),
  };
}
