/**
 * Zero-Inflated Poisson (ZIP) model for football exact-score prediction.
 *
 * Football produces more scoreless halves/games than pure Poisson predicts.
 * The ZIP model decomposes goal scoring into two processes:
 *
 *   1. "Structural zero" process (π): the match was always going to end
 *      goalless for that team regardless of attacking ability.
 *      Examples: both teams defending a lead, nothing to play for,
 *      heavily congested fixture schedule → conservative press.
 *
 *   2. "Count" process (1−π): the regular Poisson scoring process.
 *
 * ZIP PMF:
 *   P(X=0) = π + (1−π)·e^{−λ}
 *   P(X=k) = (1−π)·e^{−λ}·λ^k / k!   for k ≥ 1
 *
 * Mean  = (1−π)·λ
 * Var   = (1−π)·λ·(1 + π·λ)   > Mean (overdispersed like NegBin)
 *
 * Zero-inflation π is estimated from the expected lambdas:
 * very low lambda → teams are already expected to score little → more
 * structural zeros. High lambda → no meaningful zero-inflation.
 *
 * Typical π: 1–4% per team per match in professional football.
 *
 * Reference: Lambert (1992) "Zero-inflated Poisson regression, with an
 * application to defects in manufacturing", Technometrics 34(1):1–14.
 * Applied to football: Karlis & Ntzoufras (2000) "On modelling soccer
 * data", Student 3(4):229–244.
 */

import { poissonPmf, normalize, MAX_GOALS } from "./poisson";

/**
 * Estimate the structural zero-inflation probability π from a team's
 * expected scoring rate (lambda).
 *
 * Calibration (from football analytics literature):
 *   λ ≤ 0.5  → π ≈ 0.045  (very defensive / near-0 expected goals)
 *   λ = 0.8  → π ≈ 0.020
 *   λ = 1.0  → π ≈ 0.010
 *   λ = 1.3  → π ≈ 0.002
 *   λ ≥ 1.5  → π ≈ 0       (high-scoring team, negligible zero-inflation)
 *
 * Functional form: π = max(0, 0.06 · exp(−3.5·λ))
 * This ensures continuity and vanishes smoothly above λ≈1.5.
 */
export function estimateZeroInflation(lambda: number): number {
  if (lambda >= 1.5) return 0;
  return Math.max(0, 0.06 * Math.exp(-3.5 * lambda));
}

/**
 * Zero-Inflated Poisson PMF for a single team's goal count.
 *
 * @param k  Goals scored (non-negative integer)
 * @param lambda Expected goals under the count process
 * @param pi Zero-inflation probability (structural zeros)
 */
export function zipPmf(k: number, lambda: number, pi: number): number {
  const piClamped = Math.max(0, Math.min(0.15, pi));
  if (k === 0) {
    return piClamped + (1 - piClamped) * poissonPmf(0, lambda);
  }
  return (1 - piClamped) * poissonPmf(k, lambda);
}

/**
 * Build an independent bivariate ZIP score matrix.
 *
 * Home and away goals are modelled as independent ZIP random variables.
 * Zero-inflation is estimated automatically from the lambdas.
 *
 * The resulting matrix has more mass at (0,*) and (*,0) than pure Poisson,
 * particularly improving calibration for:
 *   - 0-0 draws (both teams zero-inflated simultaneously)
 *   - 1-0 and 0-1 wins (one team zero-inflated)
 *   - Low-lambda defensive matches in general
 *
 * @param lambdaHome Expected home goals
 * @param lambdaAway Expected away goals
 * @param piHomeOverride  Override home zero-inflation (optional, computed if null)
 * @param piAwayOverride  Override away zero-inflation (optional, computed if null)
 * @param maxGoals Grid size (0..maxGoals inclusive)
 */
export function zipScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  piHomeOverride: number | null = null,
  piAwayOverride: number | null = null,
  maxGoals: number = MAX_GOALS,
): number[][] {
  const lh = Math.max(0.05, lambdaHome);
  const la = Math.max(0.05, lambdaAway);

  const piH = piHomeOverride !== null ? piHomeOverride : estimateZeroInflation(lh);
  const piA = piAwayOverride !== null ? piAwayOverride : estimateZeroInflation(la);

  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const pH = zipPmf(i, lh, piH);
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      const pA = zipPmf(j, la, piA);
      row.push(Math.max(0, pH * pA));
    }
    m.push(row);
  }
  return normalize(m);
}

/**
 * Estimate zero-inflation from clean sheet rates (alternative to lambda-based).
 *
 * cleanSheetRate: fraction of recent matches with 0 goals conceded (defensive side).
 * The team's scoring zero-inflation is related to the OPPONENT's clean sheet rate
 * (i.e., how often the opponent kept us scoreless beyond what lambda predicts).
 *
 * This provides a data-driven alternative when match history is available.
 *
 * @param failedToScoreRate Fraction of recent matches where team scored 0 goals
 * @param lambda Expected goals (Poisson mean)
 */
export function estimateZeroInflationFromHistory(
  failedToScoreRate: number,
  lambda: number,
): number {
  // Theoretical Poisson probability of scoring 0
  const poissonZero = Math.exp(-lambda);
  // Empirical excess zeros beyond Poisson prediction
  const excessZeros = Math.max(0, failedToScoreRate - poissonZero);
  // π is the fraction of zeros that are "structural" rather than Poisson
  // π = excessZeros / (1 − poissonZero + excessZeros) approximately
  const totalZero = failedToScoreRate;
  if (totalZero <= 0) return 0;
  const pi = excessZeros / totalZero;
  return Math.max(0, Math.min(0.12, pi));
}
