/**
 * Kelly Criterion for optimal bet sizing.
 *
 * The Kelly Criterion gives the fraction of bankroll to wager on a bet
 * with edge > 0. It maximises the expected logarithmic growth of capital.
 *
 * Full Kelly: f* = (b·p - q) / b  where b = decimal_odd - 1, p = model prob, q = 1-p
 * Fractional Kelly: f = f* × fraction  (0.25 recommended for football — reduces variance)
 *
 * References:
 *   Kelly, J.L. (1956) "A New Interpretation of Information Rate", Bell System Technical Journal.
 *   Thorp, E.O. (2008) "The Kelly Criterion in Blackjack, Sports Betting, and the Stock Market".
 */

export interface KellyResult {
  /** Full Kelly fraction (raw, may be negative = no bet) */
  fullKelly: number;
  /** Quarter Kelly fraction (recommended for football) */
  quarterKelly: number;
  /** Half Kelly fraction (moderate risk) */
  halfKelly: number;
  /** Expected value per unit staked (e.g. 0.08 = 8% EV) */
  expectedValue: number;
  /** Fair odd implied by model probability */
  fairOdd: number;
  /** Whether there is a positive edge */
  hasEdge: boolean;
  /** Edge percentage (market_implied_prob - model_prob) / model_prob */
  edgePct: number;
}

/**
 * Compute Kelly fractions for a predicted score vs market odds.
 *
 * @param modelProb  Model probability of the outcome (0-1)
 * @param marketOdd  Decimal market odds (e.g. 6.50 for a 15% implied prob)
 * @returns KellyResult
 */
export function computeKelly(modelProb: number, marketOdd: number): KellyResult {
  const p = Math.max(1e-6, Math.min(1 - 1e-6, modelProb));
  const q = 1 - p;
  const b = marketOdd - 1; // net profit per unit staked

  const fullKelly = b > 0 ? (b * p - q) / b : -1;
  const expectedValue = p * b - q; // EV per unit staked

  const fairOddVal = 1 / p;
  const marketImpliedProb = marketOdd > 0 ? 1 / marketOdd : 0;
  const edgePct = marketImpliedProb > 0
    ? ((p - marketImpliedProb) / marketImpliedProb) * 100
    : 0;

  return {
    fullKelly: Math.max(-1, fullKelly),
    quarterKelly: Math.max(0, fullKelly * 0.25),
    halfKelly: Math.max(0, fullKelly * 0.5),
    expectedValue,
    fairOdd: fairOddVal,
    hasEdge: fullKelly > 0,
    edgePct,
  };
}

/**
 * Compute Kelly fractions for all top-N score predictions.
 * Market odds are matched by score key.
 */
export function kellyForTopN(
  topN: Array<{ home: number; away: number; prob: number }>,
  marketExactOdds: Record<string, number> = {},
  defaultMarketOdd: number = 0,
): Array<{ home: number; away: number; prob: number; kelly: KellyResult | null }> {
  return topN.map((cell) => {
    const key = `${cell.home}-${cell.away}`;
    const marketOdd = marketExactOdds[key] ?? defaultMarketOdd;
    if (marketOdd <= 1) {
      return { ...cell, kelly: null };
    }
    return { ...cell, kelly: computeKelly(cell.prob, marketOdd) };
  });
}

/**
 * Pythagorean Expectation for football.
 *
 * Adapted from Bill James' baseball formula for football.
 * win_rate = goals_scored^exp / (goals_scored^exp + goals_against^exp)
 *
 * For football, exp ≈ 1.9 (fitted from historical data).
 * Unlike Elo, this uses goals directly and tracks expected points.
 *
 * References:
 *   Heumann (2018) "An update of 'a statistician reads the sports pages':
 *   Pythagorean expectation in football". CHANCE 31(1).
 */
export interface PythagoreanResult {
  /** Expected win rate (0-1) */
  homeWinRate: number;
  /** Expected draw rate (0-1) estimated from symmetry */
  drawRate: number;
  /** Away win rate (0-1) */
  awayWinRate: number;
  /** Expected points per game for home team */
  homeExpectedPPG: number;
  /** Expected points per game for away team */
  awayExpectedPPG: number;
}

export function pythagoreanExpectation(
  homeAvgFor: number,
  homeAvgAgainst: number,
  awayAvgFor: number,
  awayAvgAgainst: number,
  exponent: number = 1.9,
): PythagoreanResult {
  const hF = Math.max(0.01, homeAvgFor);
  const hA = Math.max(0.01, homeAvgAgainst);
  const aF = Math.max(0.01, awayAvgFor);
  const aA = Math.max(0.01, awayAvgAgainst);

  // Pythagorean win rate for each team in a "neutral" matchup
  const homePyth = (hF ** exponent) / ((hF ** exponent) + (hA ** exponent));
  const awayPyth = (aF ** exponent) / ((aF ** exponent) + (aA ** exponent));

  // Expected goal rates for the specific matchup
  const expectedHomeGoals = (hF + aA) / 2;
  const expectedAwayGoals = (aF + hA) / 2;

  // Win probability from expected goals using Poisson-based logic
  const homeScore = (expectedHomeGoals ** exponent) /
    ((expectedHomeGoals ** exponent) + (expectedAwayGoals ** exponent));

  // Estimate draw rate from goal totals — fewer goals = more draws
  const avgGoals = expectedHomeGoals + expectedAwayGoals;
  const drawRate = Math.max(0.05, Math.min(0.40, 0.35 * Math.exp(-0.15 * avgGoals)));

  const homeWinRate = Math.min(homeScore * (1 - drawRate), 1 - drawRate);
  const awayWinRate = Math.max(0, 1 - homeWinRate - drawRate);

  // Expected points per game (3 for win, 1 for draw, 0 for loss)
  const homeExpectedPPG = homeWinRate * 3 + drawRate * 1;
  const awayExpectedPPG = awayWinRate * 3 + drawRate * 1;

  // Use in driver text: homePyth/awayPyth confirm the relative strength
  void homePyth; void awayPyth;

  return { homeWinRate, drawRate, awayWinRate, homeExpectedPPG, awayExpectedPPG };
}
