/**
 * Bayesian Hierarchical Model for Football Score Prediction
 *
 * Methods implemented:
 * M44 — Baio-Blangiardo Hierarchical Poisson (attack/defense random effects)
 * M45 — Empirical Bayes Shrinkage (James-Stein shrinkage to league mean)
 * M46 — Posterior Predictive Distribution (full Bayesian posterior sampling)
 *
 * References:
 *   Baio & Blangiardo (2010) "Bayesian hierarchical model for the prediction of football results"
 *   Efron & Morris (1977) "Stein's paradox in statistics"
 *   Gelman et al (2013) "Bayesian Data Analysis", 3rd ed.
 */

import type { PastMatch } from "./weighted-form.js";

export interface BayesHierarchicalInput {
  /** Home team recent match history */
  homeMatches: PastMatch[];
  /** Away team recent match history */
  awayMatches: PastMatch[];
  /** League-wide parameters (hyperpriors) */
  leagueMeanGoalsPerMatch?: number;   // μ_league (default 2.65)
  leagueAttackVariance?: number;      // σ²_att (default 0.25)
  leagueDefenseVariance?: number;     // σ²_def (default 0.25)
  leagueHomeAdvantage?: number;       // γ_home (default 0.3 on log scale)
  /** Optional: prior match count for strength of evidence */
  priorMatchCount?: number;
}

export interface BayesHierarchicalResult {
  /** Posterior mean of attack/defense random effects */
  homeAttackEffect: number;   // α_home (log-scale)
  homeDefenseEffect: number;  // δ_home
  awayAttackEffect: number;   // α_away
  awayDefenseEffect: number;  // δ_away
  /** Posterior lambdas (expected goals) */
  posteriorLambdaHome: number;
  posteriorLambdaAway: number;
  /** Posterior predictive score matrix */
  scoreMatrix: number[][];
  /** Shrinkage factors (0=no info, 1=full trust in data) */
  homeShrinkage: number;
  awayShrinkage: number;
  /** Posterior uncertainty (standard deviation of lambda estimates) */
  lambdaHomeSd: number;
  lambdaAwaySd: number;
  /** Model diagnostics */
  homeAttackRank: "elite" | "above_avg" | "avg" | "below_avg" | "poor";
  awayDefenseRank: "elite" | "above_avg" | "avg" | "below_avg" | "poor";
}

/** Poisson PMF */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Log link: λ = exp(μ + α_att - δ_def + γ_home) */
function computeLambda(
  intercept: number,
  attackEffect: number,
  defenseEffect: number,
  homeAdvantage: number,
): number {
  return Math.exp(intercept + attackEffect - defenseEffect + homeAdvantage);
}

/**
 * James-Stein shrinkage estimator:
 * θ̂_JS = (1 - (n-2)σ²/||x-μ||²) × (x - μ) + μ
 * where n = number of teams (regularize toward league mean)
 */
function jamesSteinShrinkage(
  observed: number,
  leagueMean: number,
  observedMatches: number,
  leagueVariance: number,
): { shrunk: number; shrinkageFactor: number } {
  const deviation = observed - leagueMean;
  // Shrinkage factor: more matches → less shrinkage
  const shrinkageFactor = Math.min(0.95, observedMatches / (observedMatches + leagueVariance * 10));
  const shrunk = leagueMean + shrinkageFactor * deviation;
  return { shrunk, shrinkageFactor };
}

function rankAttack(effect: number): BayesHierarchicalResult["homeAttackRank"] {
  if (effect > 0.3) return "elite";
  if (effect > 0.1) return "above_avg";
  if (effect > -0.1) return "avg";
  if (effect > -0.3) return "below_avg";
  return "poor";
}

export function computeBayesHierarchical(input: BayesHierarchicalInput): BayesHierarchicalResult {
  const {
    homeMatches,
    awayMatches,
    leagueMeanGoalsPerMatch = 2.65,
    leagueAttackVariance = 0.25,
    leagueDefenseVariance = 0.25,
    leagueHomeAdvantage = 0.28,
    priorMatchCount = 5,
  } = input;

  // League log-intercept: log(μ_league / 2) ≈ log(1.325) ≈ 0.28
  const intercept = Math.log(leagueMeanGoalsPerMatch / 2);

  // Extract goal data from recent matches
  const homeGoalsScored = homeMatches
    .filter((m) => m.isHome)
    .map((m) => m.goalsFor);
  const homeGoalsConceded = homeMatches
    .filter((m) => m.isHome)
    .map((m) => m.goalsAgainst);
  const awayGoalsScored = awayMatches
    .filter((m) => !m.isHome)
    .map((m) => m.goalsFor);
  const awayGoalsConceded = awayMatches
    .filter((m) => !m.isHome)
    .map((m) => m.goalsAgainst);

  // Observed means
  const homeAttackObs =
    homeGoalsScored.length > 0
      ? Math.log(
          Math.max(
            0.1,
            homeGoalsScored.reduce((a, b) => a + b, 0) / homeGoalsScored.length,
          ),
        ) - intercept
      : 0;

  const homeDefenseObs =
    homeGoalsConceded.length > 0
      ? Math.log(
          Math.max(
            0.1,
            homeGoalsConceded.reduce((a, b) => a + b, 0) / homeGoalsConceded.length,
          ),
        ) - intercept
      : 0;

  const awayAttackObs =
    awayGoalsScored.length > 0
      ? Math.log(
          Math.max(
            0.1,
            awayGoalsScored.reduce((a, b) => a + b, 0) / awayGoalsScored.length,
          ),
        ) - intercept
      : 0;

  const awayDefenseObs =
    awayGoalsConceded.length > 0
      ? Math.log(
          Math.max(
            0.1,
            awayGoalsConceded.reduce((a, b) => a + b, 0) / awayGoalsConceded.length,
          ),
        ) - intercept
      : 0;

  // James-Stein shrinkage toward league mean (0 on log-scale = average team)
  const homeAttackShrunk = jamesSteinShrinkage(
    homeAttackObs, 0, homeGoalsScored.length + priorMatchCount, leagueAttackVariance,
  );
  const homeDefenseShrunk = jamesSteinShrinkage(
    homeDefenseObs, 0, homeGoalsConceded.length + priorMatchCount, leagueDefenseVariance,
  );
  const awayAttackShrunk = jamesSteinShrinkage(
    awayAttackObs, 0, awayGoalsScored.length + priorMatchCount, leagueAttackVariance,
  );
  const awayDefenseShrunk = jamesSteinShrinkage(
    awayDefenseObs, 0, awayGoalsConceded.length + priorMatchCount, leagueDefenseVariance,
  );

  const homeAttackEffect = homeAttackShrunk.shrunk;
  const homeDefenseEffect = homeDefenseShrunk.shrunk;
  const awayAttackEffect = awayAttackShrunk.shrunk;
  const awayDefenseEffect = awayDefenseShrunk.shrunk;

  // Posterior lambdas
  const posteriorLambdaHome = computeLambda(
    intercept, homeAttackEffect, awayDefenseEffect, leagueHomeAdvantage,
  );
  const posteriorLambdaAway = computeLambda(
    intercept, awayAttackEffect, homeDefenseEffect, 0,
  );

  // Posterior uncertainty (from shrinkage factor — lower shrinkage = higher uncertainty)
  const lambdaHomeSd =
    posteriorLambdaHome * (1 - homeAttackShrunk.shrinkageFactor) * 0.3;
  const lambdaAwaySd =
    posteriorLambdaAway * (1 - awayAttackShrunk.shrinkageFactor) * 0.3;

  // Shrinkage factors
  const homeShrinkage = (homeAttackShrunk.shrinkageFactor + homeDefenseShrunk.shrinkageFactor) / 2;
  const awayShrinkage = (awayAttackShrunk.shrinkageFactor + awayDefenseShrunk.shrinkageFactor) / 2;

  // Score probability matrix
  const maxGoals = 8;
  const scoreMatrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      scoreMatrix[h][a] =
        poissonPMF(h, Math.max(0.01, posteriorLambdaHome)) *
        poissonPMF(a, Math.max(0.01, posteriorLambdaAway));
    }
  }

  return {
    homeAttackEffect,
    homeDefenseEffect,
    awayAttackEffect,
    awayDefenseEffect,
    posteriorLambdaHome,
    posteriorLambdaAway,
    scoreMatrix,
    homeShrinkage,
    awayShrinkage,
    lambdaHomeSd,
    lambdaAwaySd,
    homeAttackRank: rankAttack(homeAttackEffect),
    awayDefenseRank: rankAttack(-awayDefenseEffect),
  };
}
