/**
 * Skellam distribution: distribution of (X - Y) where X ~ Poisson(l1), Y ~ Poisson(l2).
 * Uses modified Bessel function of the first kind I_k(z).
 */

function besselI(k: number, x: number): number {
  // Series approximation, sufficient for k in [-25, 25] and x < 30.
  const absK = Math.abs(k);
  const half = x / 2;
  let sum = 0;
  let term = Math.pow(half, absK) / factorial(absK);
  sum = term;
  for (let m = 1; m < 60; m++) {
    term *= (half * half) / (m * (m + absK));
    sum += term;
    if (term < 1e-15) break;
  }
  return sum;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

export function skellamPmf(k: number, l1: number, l2: number): number {
  if (l1 <= 0 && l2 <= 0) return k === 0 ? 1 : 0;
  if (l1 <= 0) return Math.exp(-l2) * Math.pow(l2, -k) / factorial(Math.max(0, -k));
  if (l2 <= 0) return Math.exp(-l1) * Math.pow(l1, k) / factorial(Math.max(0, k));
  const ratio = Math.pow(l1 / l2, k / 2);
  const bessel = besselI(k, 2 * Math.sqrt(l1 * l2));
  return Math.exp(-(l1 + l2)) * ratio * bessel;
}

/** Standard deviation of goal difference under independent Poissons. */
export function skellamStd(l1: number, l2: number): number {
  return Math.sqrt(l1 + l2);
}
