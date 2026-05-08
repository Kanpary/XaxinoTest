/**
 * H2H Scoreline Recurrence Prior
 *
 * Research finding: specific scorelines recur more often in fixtures with
 * historical precedent than would be predicted by independent Poisson models.
 * Particularly strong for rivalry matches where tactical setups are repeated.
 *
 * Method M64 enhancement: "Advanced H2H Analysis — venue-specific + scoreline
 * recurrence" is implemented here as a matrix prior that boosts scores observed
 * in recent head-to-head history.
 *
 * Algorithm:
 *   1. Count scoreline frequencies from H2H history
 *   2. Convert to a smoothed probability matrix (Laplace smoothing to prevent
 *      zero-probability on unobserved scores)
 *   3. Blend with the model matrix proportional to H2H sample size:
 *      blendWeight = min(maxW, n_h2h × 0.015)
 *      e.g. 4 H2H games → 6% blend, 8 games → 12%, 10 games → 14% (capped)
 *
 * References:
 *   Hvattum & Arntzen (2010) "Using ELO ratings for match result prediction in
 *     association football". International Journal of Forecasting 26(3).
 *   Constantinou & Fenton (2012) "Solving the problem of inadequate scoring
 *     rules for assessing probabilistic football-match predictions".
 *     Journal of Quantitative Analysis in Sports 8(1).
 */

import { normalize } from "./poisson";

export interface H2HScorelineInput {
  /** H2H match history (goalsFor = home team goals, goalsAgainst = away) */
  h2hMatches: Array<{ goalsFor: number; goalsAgainst: number }>;
  maxGoals?: number;
  /** Maximum blend weight (0–1). Default 0.14 to avoid over-weighting thin H2H. */
  maxBlendWeight?: number;
}

export interface H2HScorelineResult {
  /** Blended model+H2H matrix (normalized) */
  blendedMatrix: number[][];
  /** Actual blend weight applied */
  appliedWeight: number;
  /** Top H2H scorelines by frequency */
  topScorelines: Array<{ home: number; away: number; count: number; freq: number }>;
  /** Whether enough H2H data exists to apply the prior */
  priorApplied: boolean;
}

/** Minimum H2H sample size to apply the prior. */
const MIN_H2H_SAMPLE = 3;

/**
 * Build a smoothed empirical probability matrix from H2H scoreline frequencies.
 *
 * Uses additive (Laplace) smoothing: each cell gets a pseudo-count α before
 * normalisation. α = 0.05 gives a gentle floor that prevents zero-probability
 * on unobserved scores while still concentrating weight on observed ones.
 */
function buildH2HMatrix(
  h2hMatches: Array<{ goalsFor: number; goalsAgainst: number }>,
  maxGoals: number,
): number[][] {
  const alpha = 0.05; // Laplace smoothing parameter
  const freqMap = new Map<string, number>();

  for (const m of h2hMatches) {
    const h = Math.min(maxGoals, Math.max(0, m.goalsFor));
    const a = Math.min(maxGoals, Math.max(0, m.goalsAgainst));
    const key = `${h}-${a}`;
    freqMap.set(key, (freqMap.get(key) ?? 0) + 1);
  }

  const matrix: number[][] = [];
  const n = h2hMatches.length;

  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const count = freqMap.get(`${h}-${a}`) ?? 0;
      // Smoothed probability: (count + α) / (n + α × numCells)
      row.push(count + alpha);
    }
    matrix.push(row);
  }

  return normalize(matrix);
}

/**
 * Blend a model score matrix with an H2H scoreline recurrence prior.
 *
 * The blend weight grows linearly with H2H sample size, capped at maxBlendWeight.
 * With fewer than MIN_H2H_SAMPLE matches the model matrix is returned unchanged.
 *
 * @param modelMatrix  Probability matrix from the ensemble (normalized)
 * @param h2hMatches   Head-to-head match history
 * @param maxBlendWeight  Maximum fraction of H2H prior to apply (default 0.14)
 */
export function blendH2HScorelinePrior(
  modelMatrix: number[][],
  h2hMatches: Array<{ goalsFor: number; goalsAgainst: number }>,
  maxBlendWeight: number = 0.14,
): H2HScorelineResult {
  const n = h2hMatches.length;
  const maxGoals = modelMatrix.length - 1;

  // Analyse top scorelines regardless of blend
  const freqMap = new Map<string, number>();
  for (const m of h2hMatches) {
    const h = Math.min(maxGoals, Math.max(0, m.goalsFor));
    const a = Math.min(maxGoals, Math.max(0, m.goalsAgainst));
    const key = `${h}-${a}`;
    freqMap.set(key, (freqMap.get(key) ?? 0) + 1);
  }
  const topScorelines = [...freqMap.entries()]
    .map(([key, count]) => {
      const [h, a] = key.split("-").map(Number);
      return { home: h ?? 0, away: a ?? 0, count, freq: count / Math.max(1, n) };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (n < MIN_H2H_SAMPLE) {
    return {
      blendedMatrix: modelMatrix,
      appliedWeight: 0,
      topScorelines,
      priorApplied: false,
    };
  }

  // Adaptive blend weight: grows with H2H sample but is capped
  // 3 games → 4.5%, 5 games → 7.5%, 8 games → 12%, 10 games → 14% (cap)
  const appliedWeight = Math.min(maxBlendWeight, n * 0.015);

  const h2hMatrix = buildH2HMatrix(h2hMatches, maxGoals);

  // Linear interpolation between model and H2H prior
  const blended: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const mp = modelMatrix[h]?.[a] ?? 0;
      const hp = h2hMatrix[h]?.[a] ?? 0;
      row.push((1 - appliedWeight) * mp + appliedWeight * hp);
    }
    blended.push(row);
  }

  return {
    blendedMatrix: normalize(blended),
    appliedWeight,
    topScorelines,
    priorApplied: true,
  };
}
