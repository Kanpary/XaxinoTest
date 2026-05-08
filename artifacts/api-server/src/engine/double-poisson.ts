/**
 * Double Poisson Model (Efron 1986) + Hurdle Model.
 *
 * DOUBLE POISSON (Efron 1986):
 * The Double Poisson distribution handles BOTH overdispersion AND underdispersion.
 * It is a two-parameter family with mean μ and dispersion θ.
 * When θ = 1 → standard Poisson.
 * When θ < 1 → underdispersed (more concentrated around mean — tight defensive games).
 * When θ > 1 → overdispersed (more spread — similar to NegBin, high variance games).
 *
 * PMF: f(y; μ, θ) ∝ (eμ)^(θy) * (ey)^(-y) * 1/(y! * c(μ, θ))
 * where c(μ, θ) is the normalising constant (approximated by truncation).
 *
 * Parameter estimation:
 *   μ = lambda (from form/elo models)
 *   θ estimated from historical goal variance:
 *     θ = var(goals) / mean(goals)  [moment estimator]
 *     θ < 1 → underdispersed, θ > 1 → overdispersed
 *
 * HURDLE MODEL (Mullahy 1986):
 * Two-part model:
 *   Part 1 (binary): P(Y = 0) = π  (from zero-inflation)
 *   Part 2 (count):  P(Y = k | k ≥ 1) from truncated Poisson
 * More flexible than ZIP because π is free of the Poisson parameter.
 * Useful for teams with structural zero-scoring tendency.
 *
 * References:
 *   Efron (1986) "Double Exponential Families and Their Use in Generalized
 *     Linear Regression". JASA 81(395):709-721.
 *   Mullahy (1986) "Specification and Testing of Some Modified Count Data
 *     Models". Journal of Econometrics 33(3):341-365.
 *   Boshnakov et al. (2017) "A bivariate Weibull count model for forecasting
 *     association football scores". International Journal of Forecasting.
 */

const MAX_ITER = 50; // normalising constant iteration limit

/**
 * Approximate normalising constant c(μ, θ) for Double Poisson.
 * Computed via truncated sum: c(μ,θ) ≈ Σ_{y=0}^{maxY} f_unnorm(y)
 */
function doublePoissonNormConst(mu: number, theta: number, maxY: number): number {
  let c = 0;
  for (let y = 0; y <= maxY; y++) {
    c += doublePoissonUnnorm(y, mu, theta);
  }
  return Math.max(1e-10, c);
}

function doublePoissonUnnorm(y: number, mu: number, theta: number): number {
  if (y < 0) return 0;
  // log f_unnorm = theta * (y * log(mu) - mu) - y * log(y) + y  (with log(0!) = 0)
  // Simplified: y * theta * log(mu) - theta * mu + y - y*log(y) - lgamma(y+1) + theta*mu
  // Careful form:
  let logVal = theta * (y * Math.log(Math.max(1e-300, mu)) - mu);
  if (y > 0) {
    // y^{-y} * e^y / y! ≈ exp(-y*log(y) + y - lgamma(y+1))
    // Use Stirling: lgamma(y+1) ≈ y*log(y) - y + 0.5*log(2πy)
    logVal += y - lgamma(y + 1);
    if (y > 0) logVal -= y * Math.log(y); // -y log(y)
    logVal += y; // +y
  }
  return Math.exp(Math.max(-700, logVal));
}

function lgamma(x: number): number {
  // Lanczos approximation
  if (x <= 0) return Infinity;
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x2 = x - 1;
  let s = c[0]!;
  for (let i = 1; i < g + 2; i++) s += c[i]! / (x2 + i);
  const t = x2 + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x2 + 0.5) * Math.log(t) - t + Math.log(s);
}

/**
 * Compute PMF of Double Poisson(μ, θ) for k = 0..maxY.
 */
export function doublePoissonPMF(mu: number, theta: number, maxY: number): number[] {
  const c = doublePoissonNormConst(mu, theta, Math.min(maxY, MAX_ITER));
  const pmf: number[] = [];
  for (let y = 0; y <= maxY; y++) {
    pmf.push(doublePoissonUnnorm(y, mu, theta) / c);
  }
  return pmf;
}

/**
 * Estimate Double Poisson dispersion θ from moment estimation.
 *   θ = variance / mean  (= 1 for standard Poisson)
 * Clamped to [0.3, 2.5] for numerical stability.
 */
export function estimateDoublePoissonTheta(mean: number, variance: number): number {
  if (mean < 0.01 || variance < 0.01) return 1.0;
  return Math.max(0.3, Math.min(2.5, variance / mean));
}

/**
 * Compute the joint Double Poisson score matrix.
 * Home and away goals are modeled independently (marginal DPs).
 */
export function doublePoissonScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  thetaHome: number,
  thetaAway: number,
  maxGoals: number,
): number[][] {
  const pmfHome = doublePoissonPMF(lambdaHome, thetaHome, maxGoals);
  const pmfAway = doublePoissonPMF(lambdaAway, thetaAway, maxGoals);

  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix.push([]);
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h]!.push((pmfHome[h] ?? 0) * (pmfAway[a] ?? 0));
    }
  }
  return matrix;
}

// ── Hurdle Model ──────────────────────────────────────────────────────────────

/**
 * Truncated Poisson PMF: P(Y = k | Y ≥ 1) for k ≥ 1.
 * Used in the count part of the Hurdle model.
 */
function truncatedPoissonPMF(lambda: number, maxY: number): number[] {
  const full: number[] = [];
  let sumFrom1 = 0;
  for (let y = 0; y <= maxY; y++) {
    let logP = -lambda + y * Math.log(Math.max(1e-300, lambda)) - lgamma(y + 1);
    const p = Math.exp(Math.max(-700, logP));
    full.push(p);
    if (y >= 1) sumFrom1 += p;
  }

  // Truncated: scale so k≥1 sums to 1
  const trunc: number[] = [0]; // P(Y=0|Y≥1) = 0
  for (let y = 1; y <= maxY; y++) {
    trunc.push(sumFrom1 > 1e-10 ? (full[y] ?? 0) / sumFrom1 : 0);
  }
  return trunc;
}

/**
 * Hurdle Model score matrix.
 * P(Y=0) = pi (zero part)
 * P(Y=k) = (1-pi) * truncatedPoisson(k|lambda) for k ≥ 1
 */
export function hurdleScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  piHome: number,  // P(home scores 0)
  piAway: number,  // P(away scores 0)
  maxGoals: number,
): number[][] {
  // Clamp pi to [0, 0.7]
  const ph = Math.max(0, Math.min(0.7, piHome));
  const pa = Math.max(0, Math.min(0.7, piAway));

  const truncHome = truncatedPoissonPMF(lambdaHome, maxGoals);
  const truncAway = truncatedPoissonPMF(lambdaAway, maxGoals);

  const hurdleHome: number[] = [ph];
  const hurdleAway: number[] = [pa];

  for (let y = 1; y <= maxGoals; y++) {
    hurdleHome.push((1 - ph) * (truncHome[y] ?? 0));
    hurdleAway.push((1 - pa) * (truncAway[y] ?? 0));
  }

  const matrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    matrix.push([]);
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h]!.push((hurdleHome[h] ?? 0) * (hurdleAway[a] ?? 0));
    }
  }
  return matrix;
}
