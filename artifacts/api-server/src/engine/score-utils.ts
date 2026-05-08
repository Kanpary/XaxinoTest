/**
 * Helpers for working with the score-matrix outputs of all engines.
 */

export interface ScoreCell {
  home: number;
  away: number;
  prob: number;
}

export function topNScores(matrix: number[][], n: number = 10): ScoreCell[] {
  const cells: ScoreCell[] = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      cells.push({ home: i, away: j, prob: matrix[i]![j]! });
    }
  }
  cells.sort((a, b) => b.prob - a.prob);
  return cells.slice(0, n);
}

export function combineMatricesWeighted(
  matrices: number[][][],
  weights: number[],
): number[][] {
  if (matrices.length === 0) return [];
  const norm = weights.reduce((s, w) => s + Math.max(0, w), 0) || 1;
  const w = weights.map((x) => Math.max(0, x) / norm);
  const rows = matrices[0]!.length;
  const cols = matrices[0]![0]!.length;
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let k = 0; k < matrices.length; k++) {
        s += w[k]! * (matrices[k]![i]?.[j] ?? 0);
      }
      row.push(s);
    }
    out.push(row);
  }
  return out;
}

/**
 * Convergence: 1 - mean total-variation distance between each matrix and the
 * ensemble mean. Higher = models agree.
 */
export function ensembleConvergence(matrices: number[][][]): number {
  if (matrices.length < 2) return 1;
  const rows = matrices[0]!.length;
  const cols = matrices[0]![0]!.length;
  // mean matrix
  const mean: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (const m of matrices) s += m[i]?.[j] ?? 0;
      row.push(s / matrices.length);
    }
    mean.push(row);
  }
  let avgTvd = 0;
  for (const m of matrices) {
    let tvd = 0;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        tvd += Math.abs((m[i]?.[j] ?? 0) - mean[i]![j]!);
      }
    }
    avgTvd += tvd / 2;
  }
  avgTvd /= matrices.length;
  return Math.max(0, 1 - avgTvd);
}

export function fairOdd(prob: number): number {
  if (prob <= 0) return Infinity;
  return 1 / prob;
}

/**
 * Z-score of an ensemble probability vs a uniform-random model.
 * Used as a "novelty" indicator — how far is our top score from base rate.
 */
export function noveltyZ(prob: number, baseRate: number = 1 / 81): number {
  // Wilson approximation under binomial null
  const n = 100;
  const p0 = baseRate;
  const variance = (p0 * (1 - p0)) / n;
  const sd = Math.sqrt(Math.max(1e-9, variance));
  return (prob - p0) / sd;
}

/**
 * Borda Count Rank Aggregation across multiple score matrices.
 *
 * Each model ranks all possible scorelines from best to worst. The final
 * consensus uses Borda count (sum of weighted positional ranks). This is more
 * robust than averaging probabilities when models disagree strongly, since
 * it gives consensus weight to scores that appear high in MOST models rather
 * than those with one extreme-high probability from a single model.
 *
 * Reference:
 *   Constantinou & Fenton (2012) showed rank aggregation outperforms probability
 *   averaging for football exact-score prediction.
 *
 * @param matrices  Array of probability matrices [home 0..max][away 0..max]
 * @param weights   Optional model weights (uniform if omitted)
 * @param topK      Number of top scores to return
 * @returns         Scores sorted by Borda score (normalized to [0,1])
 */
export function bordaCountRankAggregate(
  matrices: number[][][],
  weights?: number[],
  topK: number = 16,
): ScoreCell[] {
  if (matrices.length === 0) return [];
  const maxGoals = matrices[0]!.length - 1;
  const totalCells = (maxGoals + 1) * (maxGoals + 1);

  // Normalize weights
  const rawW = weights ?? matrices.map(() => 1);
  const wSum = rawW.reduce((s, w) => s + Math.max(0, w), 0) || 1;
  const normW = rawW.map((w) => Math.max(0, w) / wSum);

  // Accumulate weighted Borda points per scoreline
  const bordaAcc = new Float64Array(totalCells);

  for (let m = 0; m < matrices.length; m++) {
    const mat = matrices[m]!;
    const mw = normW[m] ?? (1 / matrices.length);

    // Flatten and rank
    const flat: Array<{ idx: number; prob: number }> = [];
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        flat.push({ idx: h * (maxGoals + 1) + a, prob: mat[h]?.[a] ?? 0 });
      }
    }
    flat.sort((x, y) => y.prob - x.prob);

    // Assign Borda points: rank-0 (best) gets totalCells points, rank-N gets 1
    for (let rank = 0; rank < flat.length; rank++) {
      const points = (totalCells - rank) * mw;
      bordaAcc[flat[rank]!.idx] += points;
    }
  }

  // Convert to ScoreCell and sort
  const results: ScoreCell[] = [];
  const maxBorda = totalCells; // theoretical max per unit weight
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const idx = h * (maxGoals + 1) + a;
      results.push({ home: h, away: a, prob: (bordaAcc[idx] ?? 0) / maxBorda });
    }
  }
  results.sort((a, b) => b.prob - a.prob);
  return results.slice(0, topK);
}

/**
 * Hybrid score ranking that blends MC probability with cross-model Borda rank.
 *
 * Combines the strengths of both approaches:
 *   - MC probability: captures the calibrated final estimate
 *   - Borda rank: captures cross-model consensus (robustness)
 *
 * Formula: hybridScore = mcProb × (probWeight) + bordaRank × (1 - probWeight)
 *
 * Both dimensions are normalised to [0,1] before blending.
 *
 * @param mcEntries   Scores from Monte Carlo (sorted by MC probability)
 * @param bordaScores Scores from Borda count aggregation
 * @param probWeight  How much to weight MC probability vs Borda rank (default 0.65)
 */
export function hybridRankProbScore(
  mcEntries: ScoreCell[],
  bordaScores: ScoreCell[],
  probWeight: number = 0.65,
): ScoreCell[] {
  if (mcEntries.length === 0) return [];

  // Build lookup maps
  const mcMap = new Map<string, number>();
  const maxMcProb = mcEntries[0]?.prob ?? 1;
  for (const e of mcEntries) {
    mcMap.set(`${e.home}-${e.away}`, e.prob / Math.max(1e-9, maxMcProb));
  }

  const bordaMap = new Map<string, number>();
  const maxBorda = bordaScores[0]?.prob ?? 1;
  for (const e of bordaScores) {
    bordaMap.set(`${e.home}-${e.away}`, e.prob / Math.max(1e-9, maxBorda));
  }

  // Merge all unique keys from both sources
  const allKeys = new Set<string>([...mcMap.keys(), ...bordaMap.keys()]);
  const combined: ScoreCell[] = [];

  for (const key of allKeys) {
    const [h, a] = key.split("-").map(Number);
    if (h === undefined || a === undefined || isNaN(h) || isNaN(a)) continue;

    const mcNorm = mcMap.get(key) ?? 0;
    const bordaNorm = bordaMap.get(key) ?? 0;
    const hybridScore = probWeight * mcNorm + (1 - probWeight) * bordaNorm;

    // Keep absolute MC probability for display (not normalized ratio)
    const mcAbsProb = mcEntries.find((e) => e.home === h && e.away === a)?.prob ?? 0;
    combined.push({ home: h, away: a, prob: mcAbsProb > 0 ? mcAbsProb : hybridScore * (maxMcProb || 0.01) });
  }

  // Sort by hybrid score (recompute for sorting)
  combined.sort((x, y) => {
    const xMcN = mcMap.get(`${x.home}-${x.away}`) ?? 0;
    const xBN = bordaMap.get(`${x.home}-${x.away}`) ?? 0;
    const yMcN = mcMap.get(`${y.home}-${y.away}`) ?? 0;
    const yBN = bordaMap.get(`${y.home}-${y.away}`) ?? 0;
    return (probWeight * yMcN + (1 - probWeight) * yBN) - (probWeight * xMcN + (1 - probWeight) * xBN);
  });

  return combined;
}
