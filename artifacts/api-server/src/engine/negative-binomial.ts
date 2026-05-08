/**
 * Negative Binomial score matrix for football exact-score prediction.
 *
 * Football goals exhibit slight overdispersion relative to Poisson:
 * empirical variance ≈ mean + α·mean² (α ≈ 0.15–0.25 in top leagues).
 *
 * NegBin PMF: P(X=k | μ, α) = Γ(k+r) / (k! · Γ(r)) · p^r · (1−p)^k
 * where  r = 1/α,  p = 1/(1+α·μ)  → mean = μ, var = μ + α·μ²
 *
 * As α→0:  NegBin → Poisson  (consistent with existing models).
 *
 * Overdispersion effects in football:
 *  - Heavier tail: 5-0 blowouts more likely than pure Poisson
 *  - More zero mass: 0-0 slightly more likely than pure Poisson
 *  - Less mass on mid-range: 2-1, 2-2 slightly less than Poisson
 *
 * Calibrated defaults: αHome = 0.18, αAway = 0.22
 * (away goals more variable: clean sheets vs blowouts away from home)
 *
 * Reference: Karlis & Ntzoufras (2003) "Analysis of sports data by using
 * bivariate Poisson models", The Statistician 52(3):381–393.
 */

import { poissonPmf, normalize, MAX_GOALS } from "./poisson";

// ── Lanczos approximation for log-Gamma ──────────────────────────────────────
// Accurate to 15 decimal places for all positive real x.
// Coefficients from Numerical Recipes 3rd ed., §6.1.
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

function logGamma(x: number): number {
  if (x <= 0) return Infinity;

  // Reflection formula for x < 0.5
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  // Stirling series for large x (accurate for x > 20)
  if (x > 20) {
    const lnx = Math.log(x);
    return (x - 0.5) * lnx - x + 0.5 * Math.log(2 * Math.PI)
      + 1 / (12 * x) - 1 / (360 * x * x * x);
  }

  // Lanczos core
  const z = x - 1;
  let a = LANCZOS_C[0]!;
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += LANCZOS_C[i]! / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI)
    + (z + 0.5) * Math.log(t)
    - t
    + Math.log(a);
}

// ── Negative Binomial PMF ─────────────────────────────────────────────────────

/**
 * Compute the NegBin PMF in log space for numerical stability.
 *
 * @param k  Number of goals (non-negative integer)
 * @param mu Mean goals (lambda equivalent)
 * @param alpha Dispersion parameter (0 → Poisson, 0.2 → typical football)
 */
function negBinLogPmf(k: number, mu: number, alpha: number): number {
  if (mu <= 0) return k === 0 ? 0 : -Infinity;
  if (alpha < 1e-10) {
    // Degenerate case: delegate to Poisson
    const p = poissonPmf(k, mu);
    return p > 0 ? Math.log(p) : -Infinity;
  }

  const r = 1 / alpha; // NegBin "r" (shape) parameter
  const p = 1 / (1 + alpha * mu); // success probability

  // log P(X=k) = logΓ(k+r) − logΓ(r) − logΓ(k+1) + r·log(p) + k·log(1−p)
  return (
    logGamma(k + r)
    - logGamma(r)
    - logGamma(k + 1)
    + r * Math.log(p)
    + k * Math.log(Math.max(1e-300, 1 - p))
  );
}

function negBinPmf(k: number, mu: number, alpha: number): number {
  const lp = negBinLogPmf(k, mu, alpha);
  return lp === -Infinity ? 0 : Math.max(0, Math.exp(lp));
}

// ── Score matrix ──────────────────────────────────────────────────────────────

/**
 * Build an independent bivariate Negative Binomial score matrix.
 *
 * Home and away goals are treated as independent NegBin random variables.
 * The independence assumption is the same as in the plain Poisson matrix;
 * Dixon-Coles tau correction handles low-score correlation separately.
 *
 * @param lambdaHome Expected home goals
 * @param lambdaAway Expected away goals
 * @param alphaHome  Home overdispersion (default 0.18)
 * @param alphaAway  Away overdispersion (default 0.22)
 * @param maxGoals   Grid size (0..maxGoals inclusive)
 */
export function negativeBinomialScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  alphaHome: number = 0.18,
  alphaAway: number = 0.22,
  maxGoals: number = MAX_GOALS,
): number[][] {
  const lh = Math.max(0.05, lambdaHome);
  const la = Math.max(0.05, lambdaAway);
  const ah = Math.max(0, alphaHome);
  const aa = Math.max(0, alphaAway);

  const m: number[][] = [];
  for (let i = 0; i <= maxGoals; i++) {
    const pH = negBinPmf(i, lh, ah);
    const row: number[] = [];
    for (let j = 0; j <= maxGoals; j++) {
      const pA = negBinPmf(j, la, aa);
      row.push(Math.max(0, pH * pA));
    }
    m.push(row);
  }
  return normalize(m);
}

/**
 * Estimate overdispersion from a team's recent scoring variance.
 *
 * CV (coefficient of variation) of goals scored maps to alpha:
 *   CV < 0.8  → α ≈ 0.10 (consistent scorer)
 *   CV ≈ 1.0  → α ≈ 0.18 (typical football)
 *   CV > 1.3  → α ≈ 0.30 (volatile attacker)
 */
export function estimateAlphaFromCV(
  meanGoals: number,
  goalsArray: number[],
): number {
  if (goalsArray.length < 4 || meanGoals < 0.1) return 0.18;
  const variance =
    goalsArray.reduce((s, g) => s + (g - meanGoals) ** 2, 0) / goalsArray.length;
  // alpha = (variance - mean) / mean^2  (method of moments)
  const alpha = (variance - meanGoals) / (meanGoals * meanGoals);
  // Clip: minimum 0.05 (some overdispersion always present), max 0.40
  return Math.max(0.05, Math.min(0.40, alpha));
}
