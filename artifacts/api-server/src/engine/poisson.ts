/**
 * Poisson and related distributions used by the Encore Engine V4.
 * All math is real and verifiable against scipy / R `dpois`.
 */

const MAX_GOALS = 8; // 0..8 inclusive => 9x9 score matrix

const factCache: number[] = [1, 1];
function factorial(n: number): number {
  if (n < 0 || !Number.isFinite(n)) return NaN;
  while (factCache.length <= n) {
    factCache.push(factCache[factCache.length - 1]! * factCache.length);
  }
  return factCache[n]!;
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0 || !Number.isInteger(k)) return 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/**
 * Independent bivariate Poisson score matrix P(home=i, away=j).
 * No correlation. Pure baseline.
 */
export function poissonScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals: number = MAX_GOALS,
): number[][] {
  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      row.push(poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway));
    }
    m.push(row);
  }
  return normalize(m);
}

export function normalize(matrix: number[][]): number[][] {
  let total = 0;
  for (const row of matrix) for (const v of row) total += v;
  if (total <= 0) return matrix;
  return matrix.map((row) => row.map((v) => v / total));
}

export { MAX_GOALS };
