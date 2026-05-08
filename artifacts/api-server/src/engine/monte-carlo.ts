/**
 * Monte Carlo simulator for match outcomes.
 * Samples from the score matrix N times to derive empirical distributions.
 */

export interface MCResult {
  iterations: number;
  exactScoreFreq: Map<string, number>;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  over15: number;
  over25: number;
  over35: number;
  bttsProb: number;
  avgTotalGoals: number;
  goalDiffStd: number;
}

function flattenMatrix(matrix: number[][]): { keys: string[]; cumulative: number[] } {
  const keys: string[] = [];
  const cumulative: number[] = [];
  let acc = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i]!.length; j++) {
      acc += matrix[i]![j]!;
      keys.push(`${i}-${j}`);
      cumulative.push(acc);
    }
  }
  // normalize cumulative to ensure ends at exactly 1.0
  if (acc > 0) {
    for (let i = 0; i < cumulative.length; i++) cumulative[i] = cumulative[i]! / acc;
  }
  return { keys, cumulative };
}

function sampleFromCdf(cdf: number[]): number {
  const r = Math.random();
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid]! < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function runMonteCarlo(
  scoreMatrix: number[][],
  iterations: number = 100000,
): MCResult {
  const { keys, cumulative } = flattenMatrix(scoreMatrix);
  const counts = new Map<string, number>();
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let o15 = 0;
  let o25 = 0;
  let o35 = 0;
  let btts = 0;
  let totalGoals = 0;
  let totalGoalsSq = 0;
  let totalDiff = 0;
  let totalDiffSq = 0;

  for (let n = 0; n < iterations; n++) {
    const idx = sampleFromCdf(cumulative);
    const key = keys[idx]!;
    counts.set(key, (counts.get(key) || 0) + 1);
    const dash = key.indexOf("-");
    const h = Number(key.slice(0, dash));
    const a = Number(key.slice(dash + 1));
    const total = h + a;
    const diff = h - a;
    totalGoals += total;
    totalGoalsSq += total * total;
    totalDiff += diff;
    totalDiffSq += diff * diff;
    if (h > a) homeWins++;
    else if (h === a) draws++;
    else awayWins++;
    if (total >= 2) o15++;
    if (total >= 3) o25++;
    if (total >= 4) o35++;
    if (h > 0 && a > 0) btts++;
  }

  const freq = new Map<string, number>();
  for (const [k, c] of counts.entries()) freq.set(k, c / iterations);

  const meanDiff = totalDiff / iterations;
  const varDiff = totalDiffSq / iterations - meanDiff * meanDiff;

  return {
    iterations,
    exactScoreFreq: freq,
    homeWinProb: homeWins / iterations,
    drawProb: draws / iterations,
    awayWinProb: awayWins / iterations,
    over15: o15 / iterations,
    over25: o25 / iterations,
    over35: o35 / iterations,
    bttsProb: btts / iterations,
    avgTotalGoals: totalGoals / iterations,
    goalDiffStd: Math.sqrt(Math.max(0, varDiff)),
  };
}
