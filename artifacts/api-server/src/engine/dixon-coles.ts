/**
 * Dixon-Coles 1997 low-score correction.
 * Tau adjustment fixes the underestimation of 0-0, 1-0, 0-1 and overestimation
 * of 1-1 that plain bivariate independent Poisson exhibits.
 *
 *   tau(x, y, lambda, mu, rho) =
 *     1 - lambda*mu*rho     if x=0, y=0
 *     1 + lambda*rho        if x=0, y=1
 *     1 + mu*rho            if x=1, y=0
 *     1 - rho               if x=1, y=1
 *     1                     otherwise
 *
 * In our codebase `tau` (model_state.dixon_coles_tau) is the rho parameter
 * from the original paper. Default ~ -0.05.
 */

import { poissonPmf, normalize, MAX_GOALS } from "./poisson";

export function dixonColesTau(
  x: number,
  y: number,
  lambda: number,
  mu: number,
  rho: number,
): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function dixonColesScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  maxGoals: number = MAX_GOALS,
): number[][] {
  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      const base = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway);
      const tau = dixonColesTau(i, j, lambdaHome, lambdaAway, rho);
      row.push(Math.max(0, base * tau));
    }
    m.push(row);
  }
  return normalize(m);
}
