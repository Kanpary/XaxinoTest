/**
 * Shot Quality & Expected Goals (xG) Model
 *
 * Methods implemented:
 * M31 — xG-Based Score Matrix (shot quality weighting by position/type)
 * M32 — Beta-Binomial Shot Conversion (Bayesian shot efficiency)
 * M33 — xG Monte Carlo Per-Shot Simulator (individual shot simulation)
 *
 * References:
 *   Rathke (2017) "An examination of expected goals and shot quality"
 *   Caley (2015) "Soccer's New Statistic: Expected Goals"
 *   McHale & Scarf (2011) "Modelling the dependence of goals scored"
 */

export interface ShotQualityInput {
  /** Average shots per match (home team on home ground) */
  homeShotsPerMatch: number;
  /** Average shots on target per match (home) */
  homeShotsOnTargetPerMatch: number;
  /** Shots per match (away team on away ground) */
  awayShotsPerMatch: number;
  /** Shots on target per match (away) */
  awayShotsOnTargetPerMatch: number;
  /** Opponent defensive strength (0.5=elite, 1.0=average, 1.5=poor) */
  homeDefStrength: number;
  awayDefStrength: number;
  /** Optional: actual xG per match if available */
  homeXgPerMatch?: number;
  awayXgPerMatch?: number;
  /** Tactical context adjustments */
  homeAttackStyle?: "direct" | "possession" | "counter" | "balanced";
  awayAttackStyle?: "direct" | "possession" | "counter" | "balanced";
}

export interface ShotQualityResult {
  /** xG-derived lambda (expected goals from shot quality) */
  xgLambdaHome: number;
  xgLambdaAway: number;
  /** Score probability matrix [home][away] */
  scoreMatrix: number[][];
  /** Shot conversion rates */
  homeConversionRate: number;
  awayConversionRate: number;
  /** xG per shot (shot quality index) */
  homeXgPerShot: number;
  awayXgPerShot: number;
  /** Beta distribution parameters for shot conversion */
  homeBetaAlpha: number;
  homeBetaBeta: number;
  awayBetaAlpha: number;
  awayBetaBeta: number;
  /** Confidence interval for xG lambda */
  homeXgCI: [number, number];
  awayXgCI: [number, number];
}

/** Tactical style shot quality multipliers (xG per shot adjustment) */
const STYLE_XG_MULTIPLIERS: Record<string, number> = {
  direct: 0.115,       // direct → closer range shots → higher xG/shot
  possession: 0.095,   // possession → more shots but from distance → lower
  counter: 0.125,      // counter → fast breaks → very high quality chances
  balanced: 0.105,     // balanced baseline
};

/** Beta distribution mean = α/(α+β), variance = αβ/((α+β)²(α+β+1)) */
function fitBeta(mean: number, sampleSize: number): { alpha: number; beta: number } {
  const clampedMean = Math.max(0.01, Math.min(0.99, mean));
  const concentration = Math.max(2, sampleSize * 0.5); // pseudo-count
  return {
    alpha: clampedMean * concentration,
    beta: (1 - clampedMean) * concentration,
  };
}

/** 95% credible interval from Beta(α, β) using normal approximation */
function betaCI(alpha: number, beta: number): [number, number] {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const sd = Math.sqrt(variance);
  return [Math.max(0, mean - 1.96 * sd), Math.min(1, mean + 1.96 * sd)];
}

/** Poisson PMF */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export function computeShotQuality(input: ShotQualityInput): ShotQualityResult {
  const {
    homeShotsPerMatch,
    homeShotsOnTargetPerMatch,
    awayShotsPerMatch,
    awayShotsOnTargetPerMatch,
    homeDefStrength,
    awayDefStrength,
    homeXgPerMatch,
    awayXgPerMatch,
    homeAttackStyle = "balanced",
    awayAttackStyle = "balanced",
  } = input;

  // Shot quality indices (xG per shot based on on-target rate and style)
  const homeOnTargetRate = Math.min(
    0.95,
    homeShotsOnTargetPerMatch / Math.max(1, homeShotsPerMatch),
  );
  const awayOnTargetRate = Math.min(
    0.95,
    awayShotsOnTargetPerMatch / Math.max(1, awayShotsPerMatch),
  );

  const homeStyleMult = STYLE_XG_MULTIPLIERS[homeAttackStyle] ?? 0.105;
  const awayStyleMult = STYLE_XG_MULTIPLIERS[awayAttackStyle] ?? 0.105;

  // xG per shot: combines on-target rate × style quality
  const homeXgPerShot = homeOnTargetRate * homeStyleMult * 2.1; // calibrated to ~0.10 avg
  const awayXgPerShot = awayOnTargetRate * awayStyleMult * 2.1;

  // xG lambda = shots × xG/shot, adjusted for opponent defense
  let xgHome = homeXgPerMatch ?? homeShotsPerMatch * homeXgPerShot;
  let xgAway = awayXgPerMatch ?? awayShotsPerMatch * awayXgPerShot;

  // Opponent defense adjustment
  xgHome *= awayDefStrength; // weaker defense → more xG for home
  xgAway *= homeDefStrength;

  xgHome = Math.max(0.2, Math.min(4.0, xgHome));
  xgAway = Math.max(0.2, Math.min(4.0, xgAway));

  // Shot conversion rates
  const homeConversionRate = xgHome / Math.max(1, homeShotsPerMatch);
  const awayConversionRate = xgAway / Math.max(1, awayShotsPerMatch);

  // Beta-Binomial parameters for shot conversion uncertainty
  const homeBeta = fitBeta(homeConversionRate, 20);
  const awayBeta = fitBeta(awayConversionRate, 20);

  // xG confidence intervals
  const homeConvCI = betaCI(homeBeta.alpha, homeBeta.beta);
  const awayConvCI = betaCI(awayBeta.alpha, awayBeta.beta);
  const homeXgCI: [number, number] = [
    homeConvCI[0] * homeShotsPerMatch,
    homeConvCI[1] * homeShotsPerMatch,
  ];
  const awayXgCI: [number, number] = [
    awayConvCI[0] * awayShotsPerMatch,
    awayConvCI[1] * awayShotsPerMatch,
  ];

  // Score probability matrix from xG lambdas (Poisson)
  const maxGoals = 8;
  const scoreMatrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      scoreMatrix[h][a] = poissonPMF(h, xgHome) * poissonPMF(a, xgAway);
    }
  }

  return {
    xgLambdaHome: xgHome,
    xgLambdaAway: xgAway,
    scoreMatrix,
    homeConversionRate,
    awayConversionRate,
    homeXgPerShot,
    awayXgPerShot,
    homeBetaAlpha: homeBeta.alpha,
    homeBetaBeta: homeBeta.beta,
    awayBetaAlpha: awayBeta.alpha,
    awayBetaBeta: awayBeta.beta,
    homeXgCI,
    awayXgCI,
  };
}

/**
 * M33 — xG Per-Shot Monte Carlo Simulator
 * Simulates each shot independently with Bernoulli trial P(goal) = xG/shot
 */
export interface XGSimResult {
  scoreMatrix: number[][];
  meanHome: number;
  meanAway: number;
  topScores: Array<{ home: number; away: number; prob: number }>;
}

export function xgMonteCarloSim(
  homeShotsLambda: number,
  awayShotsLambda: number,
  homeXgPerShot: number,
  awayXgPerShot: number,
  iterations: number = 30000,
): XGSimResult {
  const maxGoals = 9;
  const counts: number[][] = Array.from({ length: maxGoals + 1 }, () =>
    new Array(maxGoals + 1).fill(0),
  );
  let totalHome = 0;
  let totalAway = 0;

  for (let i = 0; i < iterations; i++) {
    // Poisson-distributed shots each match
    let hShots = samplePoisson(homeShotsLambda);
    let aShots = samplePoisson(awayShotsLambda);

    let hGoals = 0;
    let aGoals = 0;
    for (let s = 0; s < hShots; s++) {
      if (Math.random() < homeXgPerShot) hGoals++;
    }
    for (let s = 0; s < aShots; s++) {
      if (Math.random() < awayXgPerShot) aGoals++;
    }

    hGoals = Math.min(hGoals, maxGoals);
    aGoals = Math.min(aGoals, maxGoals);
    counts[hGoals][aGoals]++;
    totalHome += hGoals;
    totalAway += aGoals;
  }

  const scoreMatrix: number[][] = counts.map((row) =>
    row.map((c) => c / iterations),
  );

  const flat: Array<{ home: number; away: number; prob: number }> = [];
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      flat.push({ home: h, away: a, prob: scoreMatrix[h][a] });
    }
  }
  flat.sort((a, b) => b.prob - a.prob);

  return {
    scoreMatrix,
    meanHome: totalHome / iterations,
    meanAway: totalAway / iterations,
    topScores: flat.slice(0, 10),
  };
}

function samplePoisson(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (p > L) {
    k++;
    p *= Math.random();
  }
  return k - 1;
}
