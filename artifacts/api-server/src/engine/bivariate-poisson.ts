/**
 * Karlis & Ntzoufras bivariate Poisson with positive correlation rho.
 * P(X=x, Y=y) = exp(-(l1+l2+l3)) * (l1^x / x!) * (l2^y / y!)
 *               * sum_{k=0..min(x,y)} C(x,k) C(y,k) k! (l3 / (l1*l2))^k
 *
 * We split: l1 = lambdaHome - rho, l2 = lambdaAway - rho, l3 = rho.
 * rho >= 0 and < min(lambdaHome, lambdaAway).
 */

import { normalize, MAX_GOALS } from "./poisson";

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

function bivPmf(
  x: number,
  y: number,
  l1: number,
  l2: number,
  l3: number,
): number {
  const head =
    Math.exp(-(l1 + l2 + l3)) *
    (Math.pow(l1, x) / factorial(x)) *
    (Math.pow(l2, y) / factorial(y));
  let sum = 0;
  const upper = Math.min(x, y);
  for (let k = 0; k <= upper; k++) {
    const term =
      binom(x, k) *
      binom(y, k) *
      factorial(k) *
      (l1 > 0 && l2 > 0 ? Math.pow(l3 / (l1 * l2), k) : k === 0 ? 1 : 0);
    sum += term;
  }
  return head * sum;
}

export function bivariatePoissonScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  maxGoals: number = MAX_GOALS,
): number[][] {
  const safeRho = Math.max(
    0,
    Math.min(rho, 0.95 * Math.min(lambdaHome, lambdaAway)),
  );
  const l1 = Math.max(1e-6, lambdaHome - safeRho);
  const l2 = Math.max(1e-6, lambdaAway - safeRho);
  const l3 = safeRho;
  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      row.push(Math.max(0, bivPmf(i, j, l1, l2, l3)));
    }
    m.push(row);
  }
  return normalize(m);
}
