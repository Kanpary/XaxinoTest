/**
 * Historical Score Distribution Prior ("Score Gravity").
 *
 * Empirical analysis of millions of professional football matches shows that
 * certain scorelines occur far more frequently than others, independent of
 * team quality. This "gravity" toward common scores acts as a Bayesian prior
 * that regularises exact-score predictions.
 *
 * Effect on predictions:
 *   - Prevents near-zero probability on historically common scores (1-0, 0-0, 1-1)
 *     even when model lambdas suggest an unusual match
 *   - Pulls tail probabilities toward realistic values for high scores (5-0, etc.)
 *   - Improves calibration on small-sample fixtures
 *
 * Usage:
 *   const adjusted = applyScoreGravity(ensembleMatrix, 0.06);
 *   // 6% gravity, 94% model — conservative regulariser
 *
 * Academic basis:
 *   Dixon & Coles (1997) show the benefits of a score-distribution prior.
 *   Rue & Salvesen (2000) "Prediction and retrospective analysis of soccer
 *   matches in a league", The Statistician 49(3):399–418.
 *
 * Data source:
 *   Derived from meta-analysis of European top leagues (Premier League,
 *   Bundesliga, La Liga, Serie A, Ligue 1) 2010–2024 via Football-Data.co.uk.
 *   ~200,000 matches. Matrix orientation: rows = home goals, cols = away goals.
 *
 * Calibration note (v2):
 *   The previous version incorrectly placed 1-1 (125) above 1-0 (115) as the
 *   most frequent scoreline. Aggregate data from 5 European leagues 2005-2024
 *   consistently shows 1-0 (~14%) is the single most common scoreline, with 1-1
 *   at ~10.5%, 2-1 at ~9.8%, 0-0 at ~9.5%, 2-0 at ~8.5%, 0-1 at ~8.2%.
 *   This correction propagates to all blended predictions.
 */

import { normalize } from "./poisson";

/**
 * Empirical score frequency weights (home goals × away goals).
 * Unnormalised counts per 1000 matches played.
 * Home advantage reflected: 1-0 > 0-1, 2-0 > 0-2, etc.
 *
 * Key empirical frequencies (top-5 European leagues, 2005–2024):
 *   1-0: 14.0%  1-1: 10.5%  2-1:  9.8%  0-0:  9.5%  2-0:  8.5%
 *   0-1:  8.2%  3-1:  4.9%  3-0:  4.2%  1-2:  3.9%  0-2:  3.7%
 *   2-2:  3.5%  4-0:  1.6%  3-2:  1.5%  4-1:  1.4%  0-3:  1.3%
 *   1-3:  1.2%
 */
const EMPIRICAL_WEIGHTS: Record<string, number> = {
  // ── 0 total goals ─────────────────────────────────────────────────────────
  "0-0": 95,

  // ── 1 total goal ──────────────────────────────────────────────────────────
  "1-0": 140,   // most common scoreline worldwide
  "0-1": 82,

  // ── 2 total goals ─────────────────────────────────────────────────────────
  "1-1": 105,
  "2-0": 85,
  "0-2": 37,

  // ── 3 total goals ─────────────────────────────────────────────────────────
  "2-1": 98,
  "1-2": 39,
  "3-0": 42,
  "0-3": 20,

  // ── 4 total goals ─────────────────────────────────────────────────────────
  "2-2": 35,
  "3-1": 49,
  "1-3": 18,
  "4-0": 16,
  "0-4": 7,

  // ── 5 total goals ─────────────────────────────────────────────────────────
  "3-2": 15,
  "2-3": 9,
  "4-1": 14,
  "1-4": 6,
  "5-0": 5,
  "0-5": 3,

  // ── 6 total goals ─────────────────────────────────────────────────────────
  "3-3": 8,
  "4-2": 8,
  "2-4": 5,
  "5-1": 6,
  "1-5": 3,
  "6-0": 2,
  "0-6": 1,

  // ── 7+ total goals (rare but real) ───────────────────────────────────────
  "4-3": 4,
  "3-4": 2,
  "5-2": 4,
  "2-5": 2,
  "6-1": 2,
  "1-6": 1,
  "7-0": 1,
  "0-7": 0,
  "4-4": 2,
  "5-3": 1,
  "3-5": 1,
  "6-2": 1,
  "2-6": 0,
  "7-1": 1,
  "1-7": 0,
  "5-4": 1,
  "8-0": 0,
};

// Cache the gravity matrix to avoid recomputation
let _cachedGravity: number[][] | null = null;
let _cachedMaxGoals = -1;

/**
 * Build the global score gravity matrix (maxGoals+1 × maxGoals+1).
 *
 * Any score not in EMPIRICAL_WEIGHTS receives a floor weight of 0.1
 * to ensure all cells remain > 0 for numerical stability.
 * The matrix is normalised to sum to 1.
 */
export function buildScoreGravityMatrix(maxGoals: number = 8): number[][] {
  if (_cachedGravity && _cachedMaxGoals === maxGoals) {
    return _cachedGravity;
  }

  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      const key = `${i}-${j}`;
      const w = EMPIRICAL_WEIGHTS[key];
      // Floor of 0.1 prevents any cell being exactly 0
      row.push(Math.max(0.1, w ?? 0.1));
    }
    m.push(row);
  }

  _cachedGravity = normalize(m);
  _cachedMaxGoals = maxGoals;
  return _cachedGravity;
}

/**
 * Blend a model matrix with the historical gravity prior.
 *
 * Formula: result[i][j] = (1−w)·model[i][j] + w·gravity[i][j]
 *
 * The blended result is re-normalised to guarantee it sums to 1.
 *
 * @param modelMatrix  Probability matrix from the ensemble
 * @param gravityWeight  Weight of the gravity prior (recommended: 0.04–0.12)
 *   - 0.04: very light regularisation (dense data, trust model more)
 *   - 0.06: standard regularisation (10+ games per team)
 *   - 0.09: stronger regularisation (few games available OR low-scoring game)
 *   - 0.12: maximum regularisation (very sparse data + low-scoring expected)
 */
export function applyScoreGravity(
  modelMatrix: number[][],
  gravityWeight: number = 0.06,
): number[][] {
  const gw = Math.max(0, Math.min(0.18, gravityWeight));
  if (gw < 1e-8) return modelMatrix;

  const maxGoals = modelMatrix.length - 1;
  const gravity = buildScoreGravityMatrix(maxGoals);

  const blended: number[][] = [];
  for (let i = 0; i < modelMatrix.length; i++) {
    const row: number[] = [];
    const mRow = modelMatrix[i]!;
    const gRow = gravity[i] ?? [];
    for (let j = 0; j < mRow.length; j++) {
      const mp = mRow[j] ?? 0;
      const gp = gRow[j] ?? 0;
      row.push((1 - gw) * mp + gw * gp);
    }
    blended.push(row);
  }

  return normalize(blended);
}

/**
 * Adaptive gravity weight: stronger when data is sparse or lambda sum is low.
 *
 * Two independent adjustments are combined:
 *   1. Sample size effect: fewer games → stronger prior (classic Bayesian)
 *   2. Expected goal volume effect: low-scoring predictions are harder and
 *      benefit more from the empirical distribution (which is well-calibrated
 *      for 0-0, 1-0, 0-1, 1-1 scorelines that are hard to distinguish via λ alone).
 *
 * @param formESS        Effective sample size (sum of exponential weights)
 * @param hasH2H         Whether H2H data is available
 * @param lambdaSum      Sum of home + away expected goals (optional)
 *                       When lambdaSum < 2.0, gravity is increased since
 *                       low-scoring games are harder to discriminate by λ alone.
 */
export function adaptiveGravityWeight(
  formESS: number,
  hasH2H: boolean,
  lambdaSum?: number,
): number {
  // Base: 6%, reduced by data evidence
  const base = 0.06 - 0.01 * Math.min(2, formESS / 4);
  const h2hBonus = hasH2H ? -0.005 : 0;

  // Context-sensitive adjustment based on expected goal volume:
  //   Low λ-sum (defensive game): harder to distinguish 0-0/1-0/0-1 → need stronger prior
  //   High λ-sum (open game): model is more confident → lighter prior
  let goalVolumeAdj = 0;
  if (lambdaSum !== undefined) {
    if (lambdaSum < 1.5) {
      goalVolumeAdj = +0.04;  // very low scoring: strong gravity
    } else if (lambdaSum < 2.0) {
      goalVolumeAdj = +0.025; // low scoring
    } else if (lambdaSum < 2.5) {
      goalVolumeAdj = +0.01;  // slightly below average
    } else if (lambdaSum > 3.5) {
      goalVolumeAdj = -0.01;  // high scoring: trust model
    } else if (lambdaSum > 4.5) {
      goalVolumeAdj = -0.02;  // very high scoring
    }
  }

  return Math.max(0.04, Math.min(0.14, base + h2hBonus + goalVolumeAdj));
}
