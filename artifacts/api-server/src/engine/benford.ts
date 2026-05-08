/**
 * Benford's Law — first-digit frequency distribution.
 * Used as a sanity check on a sample of historical odds for a league:
 * organic odds samples should follow Benford; suspicious manipulation often
 * deviates. Returns chi-square statistic and a verdict.
 */

const BENFORD_PROB: Record<number, number> = {
  1: 0.301,
  2: 0.176,
  3: 0.125,
  4: 0.097,
  5: 0.079,
  6: 0.067,
  7: 0.058,
  8: 0.051,
  9: 0.046,
};

export function firstDigit(x: number): number | null {
  if (!Number.isFinite(x) || x <= 0) return null;
  let n = Math.abs(x);
  while (n >= 10) n /= 10;
  while (n < 1) n *= 10;
  return Math.floor(n);
}

export interface BenfordResult {
  sampleSize: number;
  chiSquare: number;
  conformant: boolean;
  observedFreq: Record<number, number>;
}

export function benfordTest(values: number[]): BenfordResult {
  const counts: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
  };
  let total = 0;
  for (const v of values) {
    const d = firstDigit(v);
    if (d !== null && d >= 1 && d <= 9) {
      counts[d] = (counts[d] ?? 0) + 1;
      total++;
    }
  }
  if (total === 0) {
    return { sampleSize: 0, chiSquare: 0, conformant: false, observedFreq: {} };
  }
  let chi = 0;
  const observedFreq: Record<number, number> = {};
  for (let d = 1; d <= 9; d++) {
    const expected = total * BENFORD_PROB[d]!;
    const observed = counts[d] ?? 0;
    observedFreq[d] = observed / total;
    if (expected > 0) chi += Math.pow(observed - expected, 2) / expected;
  }
  // Critical value for chi-sq with df=8 at p=0.05 is 15.51
  const conformant = chi < 15.51;
  return { sampleSize: total, chiSquare: chi, conformant, observedFreq };
}
