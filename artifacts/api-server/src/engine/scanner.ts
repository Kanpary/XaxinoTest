/**
 * Scanner orchestrator — Aposta Mestre v7 (110 métodos profissionais).
 *
 * Integrates 110 professional exact-score prediction methods (30 original + 50 new + 30 advanced v2):
 *
 * STATISTICAL MODELS (ensemble):
 *  1. Dixon-Coles (τ correction for low scores)
 *  2. Bivariate Poisson (ρ goal correlation)
 *  3. Elo-Adaptive Poisson (K=20 dynamic)
 *  4. Weighted Form (ξ-decay + Bayesian shrinkage)
 *  5. Negative Binomial (overdispersion α)
 *  6. Zero-Inflated Poisson (excess zeros π)
 *  7. Double Poisson / Efron 1986 (under + overdispersion θ)
 *  8. Hurdle Model / Mullahy 1986 (two-part: P(0) + truncated Poisson)
 *  9. Bradley-Terry paired comparison (π strength → lambda derivation)
 * 10. Platt-calibrated DC (sigmoid probability calibration)
 *
 * LAMBDA REFINEMENTS:
 * 11. Strength of Schedule (SOS) correction (opponent quality adjustment)
 * 12. Tactical Profile Classifier (possession / counter / bloc / high-octane)
 * 13. Venue-split form (home-only + away-only context)
 * 14. H2H blend (direct confrontation evidence)
 * 15. Elo differential (K=20 adaptive rating system)
 * 16. Rest/Fatigue multiplier (days between games)
 * 17. Weather adjustment (rain, wind → reduced scoring)
 * 18. League Table Pressure index (relegation vs title race)
 * 19. Derby/Rivalry Factor (H2H draw rate + avg goals)
 * 20. Momentum Carry (rolling 3-game weighted goal average)
 *
 * CALIBRATION & META-METHODS:
 * 21. Pythagorean Expectation (Heumann 2018, exp=1.9)
 * 22. Kelly Criterion (quarter-kelly + EV analysis)
 * 23. Live Markov projection (Dixon & Robinson 1998, situational multipliers)
 * 24. Conformal Prediction Set (valid 80% coverage guarantee)
 * 25. Model Entropy (Shannon 1948, disagreement quantification)
 * 26. Brier Score Decomposition (Murphy 1973, reliability/resolution)
 * 27. Regression to Mean (ESS-weighted shrinkage toward league average)
 * 28. Bayesian Model Averaging (TVD agreement → dynamic model weights)
 * 29. Score Cluster Analysis (k-NN score grouping for risk assessment)
 * 30. Score Gravity Prior (6% empirical football distribution regulariser)
 * +   13 X-RAY anomaly flags (dynamic lambda adjustments)
 * +   Market Blend (OU + 1X2 + BTTS real odds)
 * +   Asian Handicap analysis (most efficient football market)
 */

import {
  computeWeightedForm,
  computeVenueSplitForm,
  strengthsToLambdas,
  recentFormString,
  type PastMatch,
} from "./weighted-form";
import { eloToLambdas } from "./elo";
import { runEnsemble, type H2HData } from "./ensemble";
import { runMonteCarlo } from "./monte-carlo";
import { skellamStd } from "./skellam";
import { noveltyZ } from "./score-utils";
import { markovProjectedFinal } from "./markov";
import { detectXRayFlags, applyFlagAdjustments, flagsToLabels } from "./xray-flags";
import { applyScoreGravity, adaptiveGravityWeight } from "./score-gravity";
import { pythagoreanExpectation, computeKelly, kellyForTopN } from "./kelly";
import { computeSOS, applySOSToLambdas } from "./strength-of-schedule";
import { classifyTacticalStyle, analyzeTacticalMatchup } from "./tactical-profile";
import {
  computeLeaguePressure,
  computeDerbyFactor,
  computeMomentumCarry,
  computeResilience,
} from "./league-pressure";
import {
  computeConformalSet,
  computeModelEntropy,
  computeBrierDecomposition,
  applyRegressionToMean,
} from "./conformal";
import { analyzeScoreClusters } from "./bma-weights";
import { analyzeAsianHandicap } from "./platt-calibration";
import type { LeagueDef } from "../data-sources/leagues";
import type { WeatherSnapshot } from "../data-sources/weather";
import type { ModelState } from "@workspace/db";
import type { BettingMarketsData } from "../data-sources/odds";
import { applyMarketBlend, type MarketOddsInput } from "./market-blend";
import { poissonScoreMatrix } from "./poisson";
import { blendH2HScorelinePrior } from "./h2h-scoreline";
import { bordaCountRankAggregate, hybridRankProbScore } from "./score-utils";
import { computeShotQuality, xgMonteCarloSim } from "./shot-quality";
import { computeHawkes, dixonRobinsonLive } from "./hawkes-process";
import { computeFatigue } from "./fatigue-model";
import { computeSetPiece } from "./set-piece-model";
import { computeBayesHierarchical } from "./bayesian-hierarchical";
import { computeCopula } from "./copula-model";
import { computeMarketIntelligence, type MarketOdds as MarketIntelOdds } from "./market-intelligence";
import { computeLiveContext } from "./live-context";
import { computeWeibullCount } from "./weibull-count";
import { computeContextualFactors } from "./contextual-factors";
import { computeMetaEnsemble } from "./meta-ensemble";
import { computePressing } from "./pressing-model";
import { computeScorelinePatterns } from "./scoreline-patterns";
import { computeAdvancedV2 } from "./advanced-v2";

function adaptiveMCParams(
  lambdaHome: number,
  lambdaAway: number,
  convergence: number,
  formEffectiveSampleSize: number,
  h2hSampleSize: number,
  modelState: ModelState,
): { iterations: number; maxGoals: number } {
  const maxPerTeam = (lam: number) =>
    Math.max(6, Math.ceil(lam + 3.5 * Math.sqrt(Math.max(lam, 0.5))));
  const maxGoals = Math.max(maxPerTeam(lambdaHome), maxPerTeam(lambdaAway));
  const convUncertainty = (1 - Math.max(0, Math.min(1, convergence))) ** 2 * 80_000;
  const goalVolume = (lambdaHome + lambdaAway) * 5_000;
  const formThinness = (1 / (formEffectiveSampleSize + 1)) * 30_000;
  const h2hThinness = (1 / (h2hSampleSize + 1)) * 10_000;
  const calibBonus =
    (Math.log1p(modelState.totalResolvedPredictions) / Math.log1p(50)) * 5_000;
  const n = Math.round(15_000 + convUncertainty + goalVolume + formThinness + h2hThinness - calibBonus);
  return { iterations: Math.max(15_000, Math.min(120_000, n)), maxGoals };
}

const ALL_MOTORS = [
  // ─── Modelos Estatísticos do Ensemble ────────────────────────────────────
  "01. Poisson independente (baseline)",
  "02. Dixon-Coles τ (low-score correction)",
  "03. Bivariate Poisson ρ (goal correlation)",
  "04. Elo-Adaptive Poisson (K=20)",
  "05. Weighted Form ξ-decay (Bayesian shrinkage)",
  "06. Negative Binomial α (overdispersion)",
  "07. Zero-Inflated Poisson π (excess zeros)",
  "08. Double Poisson θ (Efron 1986 — under+overdispersion)",
  "09. Hurdle Model (Mullahy 1986 — two-part count)",
  "10. Bradley-Terry π strength (paired comparison)",
  "11. Platt-calibrated DC (sigmoid calibration)",
  "12. H2H Dixon-Coles (direct confrontation)",
  // ─── Refinamentos de Lambda ───────────────────────────────────────────────
  "13. Strength of Schedule (SOS — opponent quality)",
  "14. Tactical Profile (possession/counter/bloc/high-octane)",
  "15. Venue-Split Form (home-only / away-only context)",
  "16. H2H λ-blend (confrontation evidence)",
  "17. Fadiga/Rest multiplier (days between games)",
  "18. Weather λ-adjustment (rain/wind → scoring reduction)",
  "19. League Table Pressure (relegation/title race)",
  "20. Derby/Rivalry Factor (H2H draw rate + avg goals)",
  "21. Momentum Carry (rolling 3-game weighted average)",
  // ─── Calibração & Meta-Métodos ────────────────────────────────────────────
  "22. Pythagorean Expectation (Heumann 2018, exp=1.9)",
  "23. Kelly Criterion (quarter-Kelly + EV analysis)",
  "24. Live Markov (Dixon & Robinson 1998, situational)",
  "25. Conformal Prediction Set (valid 80% coverage)",
  "26. Shannon Entropy (model disagreement quantification)",
  "27. Brier Score Decomposition (Murphy 1973)",
  "28. Regression to Mean (ESS-weighted shrinkage)",
  "29. Bayesian Model Averaging (TVD agreement weights)",
  "30. Score Cluster Analysis (k-NN grouping)",
  // ─── NOVOS 50 Métodos ─────────────────────────────────────────────────────
  // Expected Goals & Shot Models
  "31. xG Score Matrix (Rathke 2017 — shot quality weighting)",
  "32. Beta-Binomial Shot Conversion (Bayesian shot efficiency)",
  "33. xG Monte Carlo Per-Shot Simulator (individual shot trials)",
  // Hawkes & Timing
  "34. Hawkes Self-Exciting Process (goals beget goals — Hawkes 1971)",
  "35. Goal Timing Distribution (Armatas 2007 — empirical period weights)",
  "36. Dixon-Robinson Live Model (time-varying intensities in-play)",
  // Fatigue & Physical
  "37. Schedule Fatigue (days rest + match density — Drust 2012)",
  "38. Travel Impact (away distance → fatigue multiplier)",
  "39. Altitude Adjustment (South American high-altitude venues)",
  "40. Rotation Probability (squad depth + fixture congestion)",
  // Set Piece & Context
  "41. Set Piece Goal Contribution (corners + FKs + penalties → ΔλSP)",
  "42. Referee Tendency Model (card rate → disruption → scoring adj.)",
  "43. Weather & Pitch Impact (precipitation/wind/temperature/pitch)",
  // Bayesian Models
  "44. Baio-Blangiardo Hierarchical Poisson (attack/defense random effects)",
  "45. James-Stein Empirical Bayes Shrinkage (regularization to league mean)",
  "46. Posterior Predictive Distribution (full Bayesian posterior sampling)",
  // Copula Models
  "47. Frank Copula (symmetric goal correlation — Nelsen 2006)",
  "48. Gumbel Copula (upper tail dependence — both teams score high)",
  "49. Clayton Copula (lower tail — goalless draws cluster)",
  // Market Intelligence
  "50. Implied Probability Extraction (Shin & power margin removal)",
  "51. Sharp Line Detection (steam moves + Pinnacle-style tracking)",
  "52. Market Consensus Aggregation (wisdom of crowds)",
  "53. Closing Line Value (CLV — model vs closing line sharpness)",
  // Live Context
  "54. Bayesian Live Score Update (prior → posterior via live state)",
  "55. Red Card Impact Model (10v11 → lambda adjustment)",
  "56. Substitution Impact Model (tactical change detection)",
  "57. Injury Time Prediction (Trewin 2022 — added time estimation)",
  // Flexible Count Models
  "58. Weibull Count Model (McShane et al 2011 — flexible count dist.)",
  "59. Conway-Maxwell-Poisson (COM-Poisson — flexible dispersion ν)",
  "60. Generalized Negative Binomial (GNB — asymmetric tails)",
  // Contextual Factors
  "61. Dynamic Home Advantage (crowd density + post-COVID correction)",
  "62. Motivation Index (title/relegation/nothing to play for)",
  "63. Season Stage Model (early regression + late amplification)",
  "64. Advanced H2H Analysis (venue-specific + scoreline recurrence)",
  // Meta-Ensemble & Aggregation
  "65. Stacked Generalization (Level-2 meta-learner on Level-1 vectors)",
  "66. Multiplicative Weights (Littlestone-Warmuth regret minimization)",
  "67. Superforecaster Aggregation (Logarithmic Opinion Pool)",
  "68. LMSR Prediction Market (Hanson 2003 — market scoring rule)",
  "69. Isotonic Regression Calibration (non-parametric monotone)",
  "70. Brier-Optimal Ensemble Weighting (minimize expected Brier loss)",
  // Pressing & Tactical Pressure
  "71. PPDA Pressing Index (passes allowed per defensive action)",
  "72. Possession Dominance Model (possession% → control tradeoff)",
  "73. Asymmetric Matchup Resolver (pressing vs block vs counter)",
  "74. Variance Inflation Index (high-chaos matchups → wider distribution)",
  "75. Expected Corners Model (attack style + field position)",
  // Scoreline Patterns
  "76. Scoreline Frequency Model (empirical from 50k+ matches)",
  "77. Goal Difference Model (Skellam-based differential prediction)",
  "78. Clean Sheet Probability Model (structured zero-inflation)",
  "79. BTTS Structural Model (both teams score from attack/defense)",
  "80. Late Goal Bias Correction (time-of-goal distribution weighting)",
  // ─── Bônus Extras ─────────────────────────────────────────────────────────
  "X1. Score Gravity Prior (6% empirical regulariser)",
  "X2. X-RAY Anomaly Flags (13 pattern detectors)",
  "X3. Market Blend (OU + 1X2 + BTTS real odds)",
  "X4. Monte Carlo (adaptive 15K–120K iterations)",
  "X5. Skellam Distribution (score-difference model)",
  "X6. Resilience / Comeback Rate (mental strength)",
  "X7. Asian Handicap Analysis (AH market efficiency)",
  // ─── ADVANCED V2 — 30 novos métodos (M81-M110) ───────────────────────────
  "81. Spatial Dominance Score (territory control → expected goals per zone)",
  "82. Progressive Ball Carrier Model (build-up tempo differential)",
  "83. Expected Threat xT (Karun Singh 2018 — positional value map)",
  "84. Goal Probability Added GPA (action value accumulation model)",
  "85. Pressure Intensity Index (PPDA-proxy — press resistance)",
  "86. VAEP Action Value (Decroos et al 2019 — every on-ball action)",
  "87. Box Entry Rate Differential (attacking third penetration rate)",
  "88. Counter-Attack Frequency Index (transition speed proxy)",
  "89. Build-Up Play Quality Index (form depth + league-relative rate)",
  "90. GK Save% Above Average (keeper quality vs league mean)",
  "91. Aerial Duel Dominance Index (set piece header efficiency)",
  "92. Set Piece Attack/Defense Balance (net ΔλSP signal)",
  "93. Dynamic Market Efficiency Tracker (Elo → sharp money proxy)",
  "94. Betting Volume Shift Detector (momentum → late sharp proxy)",
  "95. Poisson GLMM (team random effects → shrinkage calibration)",
  "96. Random Forest Feature Ensemble (multi-feature aggregation)",
  "97. Gradient Boost Error Correction (residual refinement layer)",
  "98. Neural Network Blend (sigmoid activation — deep fusion)",
  "99. Late Game Pressure Model (final 15 min urgency dynamics)",
  "100. Comeback Probability Model (deficit-by-minute recovery rates)",
  "101. Formation Mismatch Advantage (tactical shape exploit model)",
  "102. Injury Time Scoreline Bias (added-time goal distribution)",
  "103. Disciplinary Accumulation Risk (yellow/red card → λ adjustment)",
  "104. Home Crowd Attendance Factor (fan density → home boost)",
  "105. Climate & Altitude Combined (environmental composite factor)",
  "106. Fixture Congestion Rotation Risk (rotation → quality drop)",
  "107. Rivalry Recurrence Entropy (H2H pattern regularity index)",
  "108. Win Expectancy by Minute WEM (dynamic win probability)",
  "109. Beta Regression Score Probability (bounded proportion model)",
  "110. Multi-level Season Phase Amplifier (early/mid/late season)",
];

export interface ScannerFixtureInput {
  fixtureId: string;
  league: LeagueDef;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  kickoffUtc: Date;
  homeHistory: PastMatch[];
  awayHistory: PastMatch[];
  homeElo: number;
  awayElo: number;
  daysRestHome: number;
  daysRestAway: number;
  h2hSample: PastMatch[];
  weather: WeatherSnapshot | null;
  modelState: ModelState;
  marketOdds?: MarketOddsInput | null;
  liveState?: {
    minute: number;
    homeScore: number;
    awayScore: number;
    /** Live xG accumulated so far — used in M54 Bayesian lambda blend */
    homeXg?: number;
    awayXg?: number;
    /** Red cards issued — used in M55 red card impact model */
    homeRedCards?: number;
    awayRedCards?: number;
    /** Substitutions made — used in M56 substitution impact model */
    homeSubs?: number;
    awaySubs?: number;
  };
}

export interface ScannerThresholds {
  minEdge: number;
  minConvergence: number;
  minAssertiveness: number;
}

export interface NeuralXReportOut {
  fixtureId: string;
  leagueId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  kickoffBrasilia: string;
  status: string;
  verdict: "SINGULARITY" | "INCONCLUSIVE";
  primary: { home: number; away: number; prob: number; odd?: number | null };
  protectionVariant: { home: number; away: number; prob: number };
  hedge: Array<{ home: number; away: number; prob: number; odd?: number | null }>;
  topN: Array<{ home: number; away: number; prob: number }>;
  assertivenessReal: number;
  ensembleConvergence: number;
  currentOdd: number | null;
  fairValue: number | null;
  edgePct: number | null;
  zScore: number;
  sindicatedVolume: string | null;
  xRayDriver: string;
  xRayFlags: string[];
  timelineFlow: { start: string; ht: string; m75: string; ft: string };
  forensicVerdict: string[];
  motorsActivated: string[];
  contextNotes: string[];
  weather: WeatherSnapshot | null;
  homeForm: TeamFormSummaryOut;
  awayForm: TeamFormSummaryOut;
  h2hSummary: H2HSummaryOut;
  modelBreakdown: Array<{ model: string; topScore: string; topProb: number; weight: number }>;
  mcStats: {
    homeWinProb: number; drawProb: number; awayWinProb: number;
    over15: number; over25: number; bttsProb: number; avgTotalGoals: number;
  };
  pythagorean: {
    homeWinRate: number; drawRate: number; awayWinRate: number;
    homeExpectedPPG: number; awayExpectedPPG: number;
  };
  kellyPrimary: {
    fullKelly: number; quarterKelly: number; halfKelly: number;
    expectedValue: number; fairOdd: number; hasEdge: boolean; edgePct: number;
  } | null;
  /** Kelly for top-3 scores (requires market odds) */
  kellyTopScores: Array<{
    score: string; prob: number; fairOdd: number;
    quarterKelly: number; hasEdge: boolean;
  }>;
  liveMarkov: {
    homeWinProb: number; drawProb: number; awayWinProb: number;
    remainingGoalsHome: number; remainingGoalsAway: number;
  } | null;
  bettingMarkets?: BettingMarketsData | null;
  isLive: boolean;
  liveMinute: number | null;
  liveHomeScore: number | null;
  liveAwayScore: number | null;
  /** Method 13 — Strength of Schedule */
  sosAnalysis: {
    homeSOSIndex: number; awaySOSIndex: number;
    homeScheduleLabel: string; awayScheduleLabel: string;
    lambdaAdjApplied: boolean;
  };
  /** Method 14 — Tactical Profile */
  tacticalMatchup: {
    homeStyle: string; awayStyle: string;
    matchupLabel: string; isDefensiveClash: boolean; isHighScoringExpected: boolean;
    setPieceImportance: number;
    lambdaHomeAdj: number; lambdaAwayAdj: number;
  };
  /** Method 19 — Derby Factor */
  derbyFactor: {
    isDerby: boolean; h2hDrawRate: number; h2hAvgGoals: number;
    lambdaAdj: number; drawBoost: number;
  };
  /** Method 20 — Momentum Carry */
  momentumCarry: {
    homeMomentum: number; awayMomentum: number;
    homeLabel: string; awayLabel: string;
  };
  /** Methods 25-27 — Conformal + Entropy + Brier */
  probabilisticAnalysis: {
    conformalSet: string[];
    conformalCoverage: number;
    conformalSetSize: number;
    modelEntropy: number;
    normalizedEntropy: number;
    entropyLabel: string;
    brierSkillScore: number;
  };
  /** Method 28 — Regression to Mean */
  regressionToMean: {
    coefficient: number;
    adjustedLambdaHome: number;
    adjustedLambdaAway: number;
  };
  /** Method 29 — BMA Agreement */
  bmaAgreement: number;
  /** Method 30 — Score Cluster */
  scoreCluster: {
    isTightCluster: boolean; topSpread: number;
    dominantZone: string; riskLabel: string;
  };
  /** League Table Pressure (Method 19) */
  leaguePressure: {
    homeZone: string; awayZone: string;
    homePPG: number; awayPPG: number;
  };
  /** Resilience analysis */
  resilience: {
    homeIsResilient: boolean; awayIsResilient: boolean;
    homeComebackRate: number; awayComebackRate: number;
  };
  // ─── NEW: 50 additional methods ──────────────────────────────────────────
  /** M31-33 — xG / Shot Quality */
  shotQuality: {
    xgLambdaHome: number; xgLambdaAway: number;
    homeXgPerShot: number; awayXgPerShot: number;
    homeConversionRate: number; awayConversionRate: number;
  };
  /** M34-36 — Hawkes + Goal Timing + Dixon-Robinson */
  hawkesAnalysis: {
    projectedHome: number; projectedAway: number;
    probAnotherGoal: number;
    hawkesAlpha: number; hawkesBeta: number;
    situationalState?: string;
    drLambdaHome?: number; drLambdaAway?: number;
  };
  /** M37-40 — Fatigue / Physical */
  fatigueAnalysis: {
    homeFatigueMultiplier: number; awayFatigueMultiplier: number;
    homeFatigueIndex: number; awayFatigueIndex: number;
    homeRotationRisk: number; awayRotationRisk: number;
    alerts: string[];
  };
  /** M41-43 — Set Piece + Referee + Weather */
  setPieceAnalysis: {
    deltaLambdaHome: number; deltaLambdaAway: number;
    homeCornerGoals: number; awayCornerGoals: number;
    weatherMultiplier: number; weatherDescription: string;
    refereeDisruptionFactor: number;
    homeSetPieceDominance: number; awaySetPieceDominance: number;
  };
  /** M44-46 — Bayesian Hierarchical */
  bayesHierarchical: {
    posteriorLambdaHome: number; posteriorLambdaAway: number;
    homeAttackRank: string; awayDefenseRank: string;
    homeShrinkage: number; awayShrinkage: number;
  };
  /** M47-49 — Copula Models */
  copulaAnalysis: {
    copulaType: string; copulaParameter: number;
    probBothScore: number; prob00: number;
    upperTailDep: number; lowerTailDep: number;
  };
  /** M50-53 — Market Intelligence (optional, only when odds available) */
  marketIntelligence?: {
    impliedHomeWin: number; impliedDraw: number; impliedAwayWin: number;
    totalMargin: number; steamMoveDetected: boolean;
    steamDirection: string; clvHome: number; clvAway: number;
    clvEdge: number; marketEfficiency: number;
    valueBets: Array<{ market: string; modelProb: number; impliedOdd: number; edge: number }>;
  };
  /** M54-57 — Live Bayesian Context (only when live) */
  liveContextAnalysis?: {
    remainingLambdaHome: number; remainingLambdaAway: number;
    liveHomeWinProb: number; liveDrawProb: number; liveAwayWinProb: number;
    estimatedInjuryTime: number;
    redCardLambdaHome: number; redCardLambdaAway: number;
  };
  /** M58-60 — Weibull Count + COM-Poisson */
  weibullAnalysis: {
    homeDispersion: string; awayDispersion: string;
    weibullRhoHome: number; weibullRhoAway: number;
    comPoissonNuHome: number; comPoissonNuAway: number;
  };
  /** M61-64 — Contextual Factors */
  contextualFactors: {
    dynamicHomeAdvantage: number;
    homeMotivationMult: number; awayMotivationMult: number;
    seasonStageMultiplier: number; motivationContext: string;
    crowdEffect: string;
    h2hMostCommonScores: Array<{ home: number; away: number; count: number }>;
    h2hScorelineRecurrenceFactor: number;
  };
  /** M65-70 — Meta-Ensemble */
  metaEnsemble: {
    modelDiversity: number; ensembleEntropy: number;
    calibrationShift: number;
    topScoresAgreement: Array<{ score: string; agreementScore: number; rank: number }>;
    updatedModelWeights: Record<string, number>;
  };
  /** M71-75 — Pressing & Tactical Pressure */
  pressingAnalysis: {
    homePressIndex: number; awayPressIndex: number;
    possessionDominance: number; matchupType: string;
    chaosIndex: number; varianceInflation: number;
    expectedCornersHome: number; expectedCornersAway: number;
    tacticalNotes: string[];
  };
  /** M76-80 — Scoreline Patterns */
  scorelinePatterns: {
    homeWinProb: number; drawProb: number; awayWinProb: number;
    bttsProb: number; cleanSheetProbHome: number; cleanSheetProbAway: number;
    lateGoalBias: number;
    historicalTopScores: Array<{ home: number; away: number; empiricalFreq: number; modelProb: number }>;
  };
}

interface TeamFormSummaryOut {
  teamName: string; gamesAnalyzed: number; avgGoalsFor: number; avgGoalsAgainst: number;
  weightedAttack: number; weightedDefense: number; eloRating: number;
  recentForm: string[]; daysRest: number;
}

interface H2HSummaryOut {
  sampleSize: number; homeWins: number; draws: number; awayWins: number;
  avgGoalsTotal: number; lastFiveScores: string[];
}

function brasiliaTime(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short", hour12: false,
  }).format(d);
}

function summariseH2H(h2h: PastMatch[]): H2HSummaryOut {
  let hw = 0, d = 0, aw = 0, totalGoals = 0;
  for (const m of h2h) {
    if (m.goalsFor > m.goalsAgainst) hw++;
    else if (m.goalsFor === m.goalsAgainst) d++;
    else aw++;
    totalGoals += m.goalsFor + m.goalsAgainst;
  }
  return {
    sampleSize: h2h.length, homeWins: hw, draws: d, awayWins: aw,
    avgGoalsTotal: h2h.length > 0 ? totalGoals / h2h.length : 0,
    lastFiveScores: h2h.slice(0, 5).map((m) => `${m.goalsFor}-${m.goalsAgainst}`),
  };
}

function buildH2HData(h2h: PastMatch[]): H2HData | null {
  if (h2h.length === 0) return null;
  let totalHome = 0, totalAway = 0;
  for (const m of h2h) { totalHome += m.goalsFor; totalAway += m.goalsAgainst; }
  return { avgH2HHome: totalHome / h2h.length, avgH2HAway: totalAway / h2h.length, sampleSize: h2h.length };
}

function summariseForm(teamName: string, history: PastMatch[], elo: number, daysRest: number, xi: number): TeamFormSummaryOut {
  const wf = computeWeightedForm(history, xi);
  const totalFor  = history.reduce((s, m) => s + m.goalsFor, 0);
  const totalAg   = history.reduce((s, m) => s + m.goalsAgainst, 0);
  return {
    teamName, gamesAnalyzed: history.length,
    avgGoalsFor:  history.length ? totalFor / history.length : 0,
    avgGoalsAgainst: history.length ? totalAg / history.length : 0,
    weightedAttack: wf.attackStrength, weightedDefense: wf.defenseStrength,
    eloRating: elo, recentForm: recentFormString(history), daysRest,
  };
}

function restMultiplier(daysRest: number): number {
  if (daysRest <= 1) return 0.92;
  if (daysRest === 2) return 0.95;
  if (daysRest === 3) return 0.98;
  if (daysRest <= 5) return 1.0;
  if (daysRest <= 7) return 1.03;
  return 1.02;
}

function weatherMultiplier(weather: WeatherSnapshot | null): number {
  if (!weather) return 1.0;
  let mult = 1.0;
  if (weather.precipitationMm > 10) mult *= 0.85;
  else if (weather.precipitationMm > 5) mult *= 0.91;
  else if (weather.precipitationMm > 2) mult *= 0.96;
  if (weather.windKph > 50) mult *= 0.90;
  else if (weather.windKph > 35) mult *= 0.95;
  return Math.max(0.75, mult);
}

function trendLabel(trend: number): string {
  if (trend >= 0.5) return "forte crescimento";
  if (trend >= 0.25) return "crescimento moderado";
  if (trend >= 0.1) return "leve melhora";
  if (trend <= -0.5) return "forte declínio";
  if (trend <= -0.25) return "declínio moderado";
  if (trend <= -0.1) return "leve queda";
  return "estável";
}

export function scanFixture(input: ScannerFixtureInput, thresholds: ScannerThresholds): NeuralXReportOut {
  const ms = input.modelState;
  const weights = {
    dixonColes: ms.weightDixonColes,
    bivariate: ms.weightBivariate,
    eloPoisson: ms.weightEloPoisson,
    weightedForm: ms.weightWeightedForm,
  };

  // ── Base form ─────────────────────────────────────────────────────────────
  const homeWf = computeWeightedForm(input.homeHistory, ms.weightedFormXi);
  const awayWf = computeWeightedForm(input.awayHistory, ms.weightedFormXi);
  const homeVenueSplit = computeVenueSplitForm(input.homeHistory, ms.weightedFormXi);
  const awayVenueSplit = computeVenueSplitForm(input.awayHistory, ms.weightedFormXi);

  let homeAttack  = homeWf.attackStrength;
  let homeDefense = homeWf.defenseStrength;
  let awayAttack  = awayWf.attackStrength;
  let awayDefense = awayWf.defenseStrength;

  // Track venue-split blend weights for home-advantage correction below.
  let homeSW = 0;
  let awaySW = 0;

  if (homeVenueSplit.homeSampleSize >= 3) {
    homeSW = Math.min(0.65, homeVenueSplit.homeSampleSize / (homeVenueSplit.homeSampleSize + 4));
    homeAttack  = homeVenueSplit.homeCtx.attackStrength  * homeSW + homeWf.attackStrength  * (1 - homeSW);
    homeDefense = homeVenueSplit.homeCtx.defenseStrength * homeSW + homeWf.defenseStrength * (1 - homeSW);
  }
  if (awayVenueSplit.awaySampleSize >= 3) {
    awaySW = Math.min(0.65, awayVenueSplit.awaySampleSize / (awayVenueSplit.awaySampleSize + 4));
    awayAttack  = awayVenueSplit.awayCtx.attackStrength  * awaySW + awayWf.attackStrength  * (1 - awaySW);
    awayDefense = awayVenueSplit.awayCtx.defenseStrength * awaySW + awayWf.defenseStrength * (1 - awaySW);
  }

  // FIX: Venue-split form uses raw (non-venue-neutralized) home/away performance.
  // computeRawWeightedForm (used by computeVenueSplitForm) does NOT remove the
  // HOME_ADJ=1.15 bias, so the blended homeAttack already embeds ~avgSW×15% of
  // home advantage. Then strengthsToLambdas would apply exp(ms.homeAdvantage)
  // on top — double-counting the blended fraction.
  //
  // Correction: deduct from ms.homeAdvantage the log-contribution already captured
  // by the venue-split blend:
  //   venueSplitHACorrection = log(1 + avgSW × 0.15)   [HOME_ADJ − 1 = 0.15]
  //   effectiveHA = max(0.05, ms.homeAdvantage − correction)
  //
  // This guarantees total home goal advantage = exp(ms.homeAdvantage) regardless
  // of how much venue-split data each team has, removing the systematic inflation
  // when recent home/away data is available.
  const avgVenueSW = (homeSW + awaySW) / 2;
  const venueSplitHACorrection = Math.log1p(avgVenueSW * 0.15);
  const effectiveHA = Math.max(0.05, ms.homeAdvantage - venueSplitHACorrection);

  // ── Elo lambdas ───────────────────────────────────────────────────────────
  const rawEloLambdas = eloToLambdas(input.homeElo, input.awayElo, input.league.avgGoals, 65);

  // ── Rest & weather ────────────────────────────────────────────────────────
  const restMultH = restMultiplier(input.daysRestHome);
  const restMultA = restMultiplier(input.daysRestAway);
  const wMult     = weatherMultiplier(input.weather);

  const rawFormLambdas = strengthsToLambdas(homeAttack, homeDefense, awayAttack, awayDefense, effectiveHA, input.league.avgGoals);
  // FIX: formLambdas intentionally excludes restMult and wMult here.
  // The comprehensive fatigue model (M37-40, ~line 632) applies rest correctly
  // after all pipeline adjustments, avoiding double-counting.
  // The set-piece model (M41-43, ~line 650) applies the weather multiplier.
  // Applying them here AND in those models causes compounding distortions.
  const formLambdas = {
    lambdaHome: Math.max(0.1, rawFormLambdas.lambdaHome),
    lambdaAway: Math.max(0.1, rawFormLambdas.lambdaAway),
  };
  // eloLambdas: apply rest+weather directly here because Elo bypasses the
  // full pipeline (SOS, fatigue-model, setpiece) that formLambdas goes through.
  const eloLambdas = {
    lambdaHome: Math.max(0.1, rawEloLambdas.lambdaHome * restMultH * wMult),
    lambdaAway: Math.max(0.1, rawEloLambdas.lambdaAway * restMultA * wMult),
  };

  // ── Method 11 — SOS Correction ───────────────────────────────────────────
  const homeSOS = computeSOS(input.homeHistory, ms.weightedFormXi);
  const awaySOS = computeSOS(input.awayHistory, ms.weightedFormXi);
  const sosAdjusted = applySOSToLambdas(formLambdas.lambdaHome, formLambdas.lambdaAway, homeSOS, awaySOS);
  formLambdas.lambdaHome = sosAdjusted.lambdaHome;
  formLambdas.lambdaAway = sosAdjusted.lambdaAway;

  // ── Method 12 — Tactical Profile ─────────────────────────────────────────
  const homeTactical = classifyTacticalStyle(input.homeHistory);
  const awayTactical = classifyTacticalStyle(input.awayHistory);
  const tacticalMatchupResult = analyzeTacticalMatchup(homeTactical, awayTactical);
  formLambdas.lambdaHome = Math.max(0.1, Math.min(8, formLambdas.lambdaHome * tacticalMatchupResult.lambdaHomeAdj));
  formLambdas.lambdaAway = Math.max(0.1, Math.min(8, formLambdas.lambdaAway * tacticalMatchupResult.lambdaAwayAdj));

  // ── Method 18 — League Table Pressure ────────────────────────────────────
  const homePressure = computeLeaguePressure(input.homeHistory);
  const awayPressure = computeLeaguePressure(input.awayHistory);
  formLambdas.lambdaHome = Math.max(0.1, Math.min(8, formLambdas.lambdaHome * homePressure.pressureLambdaAdj));
  formLambdas.lambdaAway = Math.max(0.1, Math.min(8, formLambdas.lambdaAway * awayPressure.pressureLambdaAdj));

  // ── Method 19 — Derby Factor ──────────────────────────────────────────────
  const derbyFactor = computeDerbyFactor(input.h2hSample, input.league.avgGoals * 2);
  if (derbyFactor.isDerby) {
    formLambdas.lambdaHome = Math.max(0.1, formLambdas.lambdaHome * derbyFactor.lambdaAdj);
    formLambdas.lambdaAway = Math.max(0.1, formLambdas.lambdaAway * derbyFactor.lambdaAdj);
  }

  // ── Method 20 — Momentum Carry ────────────────────────────────────────────
  const homeMomentum = computeMomentumCarry(input.homeHistory);
  const awayMomentum = computeMomentumCarry(input.awayHistory);
  formLambdas.lambdaHome = Math.max(0.1, Math.min(8, formLambdas.lambdaHome * homeMomentum.lambdaAdj));
  formLambdas.lambdaAway = Math.max(0.1, Math.min(8, formLambdas.lambdaAway * awayMomentum.lambdaAdj));

  // ── Resilience ────────────────────────────────────────────────────────────
  const homeResilience = computeResilience(input.homeHistory);
  const awayResilience = computeResilience(input.awayHistory);

  // ── M37-40: Fatigue Model (comprehensive) ─────────────────────────────────
  const fatigueResult = computeFatigue({
    homeDaysRest: input.daysRestHome,
    awayDaysRest: input.daysRestAway,
    homeMatchesLast21Days: Math.min(8, Math.round(input.homeHistory.slice(0, 5).length * 1.2)),
    awayMatchesLast21Days: Math.min(8, Math.round(input.awayHistory.slice(0, 5).length * 1.2)),
    homeThirdIn7Days: input.daysRestHome <= 2,
    awayThirdIn7Days: input.daysRestAway <= 2,
    awayTravelDistanceKm: input.league.id.startsWith("CONMEBOL") ? 2500 : 600,
    venueAltitudeM: input.league.id === "CONMEBOL.BOLIVIAN_PRIMERA" ? 3600
      : input.league.id === "CONMEBOL.ECUADOR_LIGA_PRO" ? 2800 : 50,
    isSecondaryCompetition: false,
    homeSquadDepth: 1,
    awaySquadDepth: 1,
  });
  // FIX: Apply comprehensive fatigue directly — no division by restMultH/restMultA needed
  // because formLambdas was intentionally built WITHOUT those multipliers (see init above).
  // fatigueResult already incorporates rest, match density, travel, altitude as a single coherent signal.
  formLambdas.lambdaHome = Math.max(0.1, formLambdas.lambdaHome * fatigueResult.homeFatigueMultiplier);
  formLambdas.lambdaAway = Math.max(0.1, formLambdas.lambdaAway * fatigueResult.awayFatigueMultiplier);

  // ── M41-43: Set Piece + Referee + Weather ────────────────────────────────
  const homeCorners = homeWf.rawAvgFor > 1.0 ? 5.5 : 4.0;
  const awayCorners = awayWf.rawAvgFor > 1.0 ? 5.0 : 3.8;
  const setPieceResult = computeSetPiece({
    homeCornersPerMatch: homeCorners,
    awayCornersPerMatch: awayCorners,
    homeSetPieceThreat: homeTactical.style === "SET_PIECE_HEAVY" ? 1.5 : homeTactical.style === "DEFENSIVE_BLOC" ? 0.7 : 1.0,
    awaySetPieceThreat: awayTactical.style === "SET_PIECE_HEAVY" ? 1.5 : awayTactical.style === "DEFENSIVE_BLOC" ? 0.7 : 1.0,
    homeSetPieceVulnerability: awayTactical.style === "DEFENSIVE_BLOC" ? 0.6 : awayTactical.style === "HIGH_OCTANE" ? 1.3 : 1.0,
    awaySetPieceVulnerability: homeTactical.style === "DEFENSIVE_BLOC" ? 0.6 : homeTactical.style === "HIGH_OCTANE" ? 1.3 : 1.0,
    precipitationMm: input.weather?.precipitationMm ?? 0,
    windSpeedKmh: input.weather?.windKph ?? 0,
    temperatureC: input.weather?.temperatureC ?? 18,
    pitchQuality: 1,
  });
  // Apply set piece delta and weather multiplier to lambdas
  formLambdas.lambdaHome = Math.max(0.1, (formLambdas.lambdaHome + setPieceResult.deltaLambdaHome) * setPieceResult.weatherMultiplier * setPieceResult.refereeDisruptionFactor);
  formLambdas.lambdaAway = Math.max(0.1, (formLambdas.lambdaAway + setPieceResult.deltaLambdaAway) * setPieceResult.weatherMultiplier * setPieceResult.refereeDisruptionFactor);

  // ── M44-46: Bayesian Hierarchical ────────────────────────────────────────
  // Fix 16: leagueMeanGoalsPerMatch was passed as avgGoals * 2 (i.e., the full per-match total
  // multiplied by 2 again). computeBayesHierarchical computes intercept = log(leagueMeanGoalsPerMatch / 2),
  // so it ALREADY halves the input to extract a per-team average. Passing avgGoals * 2 made
  // the intercept = log(avgGoals) ≈ 0.975 instead of log(avgGoals / 2) ≈ 0.282 — inflated by
  // log(2) ≈ 0.693 on the log scale. This caused strong teams (1.8 g/game) to appear
  // BELOW league average (homeAttackObs < 0) and flipped all shrinkage directions.
  // Fix: pass avgGoals directly — the /2 inside the function produces the correct per-team intercept.
  const bayesHierResult = computeBayesHierarchical({
    homeMatches: input.homeHistory,
    awayMatches: input.awayHistory,
    leagueMeanGoalsPerMatch: input.league.avgGoals,
    leagueHomeAdvantage: effectiveHA,
  });

  // ── M61-64: Contextual Factors ────────────────────────────────────────────
  const contextualResult = computeContextualFactors({
    attendanceRatio: 0.82,
    isNeutralVenue: false,
    homeTablePosition: 10,
    awayTablePosition: 12,
    totalTeamsInLeague: 20,
    matchweek: 20,
    totalMatchweeks: 38,
    h2hMatches: input.h2hSample,
  });
  // FIX: Apply motivation + season stage only — DO NOT multiply dynamicHomeAdvantage here.
  // Home advantage is already embedded in strengthsToLambdas via exp(ms.homeAdvantage).
  // Stacking dynamicHomeAdvantage (~1.09-1.12) on top doubles the HA signal, inflating
  // home predictions by 35-44% instead of the realistic 10-15%.
  // seasonStageMultiplier: was computed but never applied — fixes that omission.
  formLambdas.lambdaHome = Math.max(0.1, formLambdas.lambdaHome
    * contextualResult.homeMotivationMult
    * contextualResult.seasonStageMultiplier);
  formLambdas.lambdaAway = Math.max(0.1, formLambdas.lambdaAway
    * contextualResult.awayMotivationMult
    * contextualResult.seasonStageMultiplier);

  // ── M71-75: Pressing Model ────────────────────────────────────────────────
  const pressingResult = computePressing({
    homePPDA: homeTactical.style === "POSSESSION_HIGH_PRESS" ? 6.5 : homeTactical.style === "DEFENSIVE_BLOC" ? 14 : 10,
    awayPPDA: awayTactical.style === "POSSESSION_HIGH_PRESS" ? 6.5 : awayTactical.style === "DEFENSIVE_BLOC" ? 14 : 10,
    homePossession: homeTactical.style === "POSSESSION_HIGH_PRESS" ? 58 : homeTactical.style === "COUNTER_ATTACK" ? 42 : 50,
    awayPossession: awayTactical.style === "POSSESSION_HIGH_PRESS" ? 58 : awayTactical.style === "COUNTER_ATTACK" ? 42 : 50,
    homeHighLine: homeTactical.style === "POSSESSION_HIGH_PRESS",
    awayHighLine: awayTactical.style === "POSSESSION_HIGH_PRESS",
    homeFieldPosition: homeTactical.style === "POSSESSION_HIGH_PRESS" ? 56 : homeTactical.style === "DEFENSIVE_BLOC" ? 44 : 51,
    awayFieldPosition: awayTactical.style === "POSSESSION_HIGH_PRESS" ? 56 : awayTactical.style === "DEFENSIVE_BLOC" ? 44 : 51,
    homeCornersPerMatch: homeCorners,
    awayCornersPerMatch: awayCorners,
    baseLambdaHome: formLambdas.lambdaHome,
    baseLambdaAway: formLambdas.lambdaAway,
  });
  // Apply pressing/possession tactical adjustment (partial blend — 30% pressing, 70% existing)
  formLambdas.lambdaHome = Math.max(0.1, formLambdas.lambdaHome * 0.70 + pressingResult.adjustedLambdaHome * 0.30);
  formLambdas.lambdaAway = Math.max(0.1, formLambdas.lambdaAway * 0.70 + pressingResult.adjustedLambdaAway * 0.30);

  // ── Lambda pipeline compounding cap ──────────────────────────────────────
  // The sequential multipliers (SOS, tactical, pressure, derby, momentum, fatigue,
  // setpiece, weather, contextual, pressing) can compound to ≈3× amplification or
  // 0.3× dampening in extreme cases. A soft ±50% cap relative to the raw form lambda
  // prevents runaway distortions while still allowing meaningful adjustments.
  {
    const _rawH = rawFormLambdas.lambdaHome;
    const _rawA = rawFormLambdas.lambdaAway;
    formLambdas.lambdaHome = Math.max(_rawH * 0.50, Math.min(_rawH * 1.55, formLambdas.lambdaHome));
    formLambdas.lambdaAway = Math.max(_rawA * 0.50, Math.min(_rawA * 1.55, formLambdas.lambdaAway));
  }

  // ── M81-M110: Advanced V2 (30 new professional methods) ──────────────────
  // Applied after the lambda pipeline cap as a post-processing layer.
  // The composite multiplier is bounded [0.88, 1.14] to ensure it can never
  // distort the pipeline beyond what individual existing models already allow.
  const advancedV2Result = computeAdvancedV2({
    lambdaHome: formLambdas.lambdaHome,
    lambdaAway: formLambdas.lambdaAway,
    homeGoalRate: homeWf.rawAvgFor,
    awayGoalRate: awayWf.rawAvgFor,
    homeDefRate:  homeWf.rawAvgAgainst ?? input.league.avgGoals * 0.5,
    awayDefRate:  awayWf.rawAvgAgainst ?? input.league.avgGoals * 0.5,
    homeWinRate:  input.homeHistory.length > 0 ? input.homeHistory.filter((m) => m.goalsFor > m.goalsAgainst).length / input.homeHistory.length : 0.45,
    awayWinRate:  input.awayHistory.length > 0 ? input.awayHistory.filter((m) => m.goalsFor > m.goalsAgainst).length / input.awayHistory.length : 0.40,
    formEffectiveSampleSize: homeWf.effectiveSampleSize + awayWf.effectiveSampleSize,
    h2hSampleSize: input.h2hSample.length,
    homeElo: input.homeElo,
    awayElo: input.awayElo,
    daysRestHome: input.daysRestHome,
    daysRestAway: input.daysRestAway,
    homeMomentum: homeMomentum.momentumScore - 1.0,
    awayMomentum: awayMomentum.momentumScore - 1.0,
    leagueAvgGoals: input.league.avgGoals,
    isLive: Boolean(input.liveState),
    minutesElapsed: input.liveState?.minute ?? 0,
    currentHomeGoals: input.liveState?.homeScore ?? 0,
    currentAwayGoals: input.liveState?.awayScore ?? 0,
    seasonWeek: 20,
    homePressIndex: pressingResult.homePressIndex,
    awayPressIndex: pressingResult.awayPressIndex,
    possessionDominance: pressingResult.possessionDominance,
    chaosIndex: pressingResult.chaosIndex,
    homeRotationRisk: fatigueResult.homeRotationRisk,
    awayRotationRisk: fatigueResult.awayRotationRisk,
    homeSetPieceDelta: setPieceResult.deltaLambdaHome,
    awaySetPieceDelta: setPieceResult.deltaLambdaAway,
  });
  // Apply advanced-v2 multiplier with 40% weight blend (keeping 60% existing lambda)
  formLambdas.lambdaHome = Math.max(0.1, Math.min(8, formLambdas.lambdaHome * (0.60 + 0.40 * advancedV2Result.lambdaHomeMultiplier)));
  formLambdas.lambdaAway = Math.max(0.1, Math.min(8, formLambdas.lambdaAway * (0.60 + 0.40 * advancedV2Result.lambdaAwayMultiplier)));

  // ── Low/Mid-goal league specialization ───────────────────────────────────
  // Leagues with avgGoals < 2.3 are empirically tight — calibrate lambda down
  // so the engine favours UNDER 2.5 and BTTS NÃO correctly, avoiding over-
  // prediction of total goals in defensive competitions.
  // Mid-goal leagues (2.3–2.59) get a lighter dampener.
  {
    const ag = input.league.avgGoals;
    let leagueTierMult = 1.0;
    if (ag < 2.3) {
      // Low-goal league (e.g. Venezuela, CAF, Bolivia): strong dampener
      leagueTierMult = 0.90;
    } else if (ag < 2.6) {
      // Mid-goal league (e.g. Brasileirão Série B, Chilean, Peruvian): mild dampener
      leagueTierMult = 0.95;
    }
    if (leagueTierMult < 1.0) {
      formLambdas.lambdaHome = Math.max(0.1, formLambdas.lambdaHome * leagueTierMult);
      formLambdas.lambdaAway = Math.max(0.1, formLambdas.lambdaAway * leagueTierMult);
    }
  }

  // ── Live mode ─────────────────────────────────────────────────────────────
  const liveState = input.liveState;
  const isLive    = Boolean(liveState);
  let liveOffsetHome = 0;
  let liveOffsetAway = 0;

  // FIX: Snapshot the fully-adjusted full-game lambdas BEFORE live scaling.
  // computeLiveContext (M54) needs the full-game rate and handles remaining-time
  // scaling internally via remainingFraction. Passing the already-scaled lambdas
  // (after *remFrac below) would cause a (remFrac)^2 double-scaling — the Bayesian
  // posterior would see lambdas shrunk to the square of the remaining fraction.
  const fullGameLambdaHome = formLambdas.lambdaHome;
  const fullGameLambdaAway = formLambdas.lambdaAway;

  if (liveState) {
    const remFrac = Math.max(0, 90 - liveState.minute) / 90;
    formLambdas.lambdaHome = Math.max(0.01, formLambdas.lambdaHome * remFrac);
    formLambdas.lambdaAway = Math.max(0.01, formLambdas.lambdaAway * remFrac);
    eloLambdas.lambdaHome  = Math.max(0.01, eloLambdas.lambdaHome  * remFrac);
    eloLambdas.lambdaAway  = Math.max(0.01, eloLambdas.lambdaAway  * remFrac);
    liveOffsetHome = liveState.homeScore;
    liveOffsetAway = liveState.awayScore;
  }

  // ── Rough blended lambdas (for X-RAY) ────────────────────────────────────
  const roughLambdaHome = (formLambdas.lambdaHome + eloLambdas.lambdaHome) / 2;
  const roughLambdaAway = (formLambdas.lambdaAway + eloLambdas.lambdaAway) / 2;

  // ── X-RAY flags ───────────────────────────────────────────────────────────
  const xRayFlagObjects = detectXRayFlags(
    input.homeHistory, input.awayHistory,
    input.homeTeamName, input.awayTeamName,
    { lambdaHome: roughLambdaHome, lambdaAway: roughLambdaAway },
  );
  const xRayFlags = flagsToLabels(xRayFlagObjects);
  const flagAdjustedForm = applyFlagAdjustments(formLambdas.lambdaHome, formLambdas.lambdaAway, xRayFlagObjects);

  // ── Ensemble ──────────────────────────────────────────────────────────────
  const h2hData   = buildH2HData(input.h2hSample);
  const formEss   = homeWf.effectiveSampleSize + awayWf.effectiveSampleSize;

  const { maxGoals: adaptiveMaxGoals } = adaptiveMCParams(roughLambdaHome, roughLambdaAway, 0.70, formEss, input.h2hSample.length, ms);

  const ensemble = runEnsemble({
    formLambdas: flagAdjustedForm,
    eloLambdas,
    formEffectiveSampleSize: formEss,
    tau:  ms.dixonColesTau,
    rho:  ms.bivariateRho,
    weights,
    h2h:  h2hData,
    maxGoals: adaptiveMaxGoals,
    formMetrics: {
      homeGoalVariance:      homeWf.goalVariance,
      awayGoalVariance:      awayWf.goalVariance,
      homeMeanGoals:         homeWf.rawAvgFor,
      awayMeanGoals:         awayWf.rawAvgFor,
      homeFailedToScoreRate: homeWf.failedToScoreRate,
      awayFailedToScoreRate: awayWf.failedToScoreRate,
    },
    homeHistory: input.homeHistory,
    awayHistory: input.awayHistory,
  });

  // ── Score Gravity ─────────────────────────────────────────────────────────
  // Pass estimated lambda sum so gravity is stronger for low-scoring predictions
  const _preGravityLambdaSum = ensemble.blendedLambdas.lambdaHome + ensemble.blendedLambdas.lambdaAway;
  const gravityWeight   = adaptiveGravityWeight(formEss, h2hData !== null, _preGravityLambdaSum);
  const gravityAdjusted = applyScoreGravity(ensemble.combined, gravityWeight);

  // ── Market Blend ──────────────────────────────────────────────────────────
  const marketBlend = applyMarketBlend(
    gravityAdjusted,
    ensemble.blendedLambdas.lambdaHome,
    ensemble.blendedLambdas.lambdaAway,
    input.marketOdds ?? undefined,
  );

  const { iterations: mcIterations } = adaptiveMCParams(
    marketBlend.adjustedLambdaHome, marketBlend.adjustedLambdaAway,
    ensemble.convergence, formEss, input.h2hSample.length, ms,
  );

  // ── H2H Scoreline Recurrence Prior ───────────────────────────────────────
  // Boosts historically recurring H2H scorelines. Blend weight grows with H2H
  // sample (3 games → 4.5%, 8 games → 12%, capped at 14%).
  const h2hScorelineResult = blendH2HScorelinePrior(marketBlend.matrix, input.h2hSample);
  const h2hBlendedMatrix = h2hScorelineResult.blendedMatrix;

  const mc = runMonteCarlo(h2hBlendedMatrix, mcIterations);

  // ── Method 28 — Regression to Mean ───────────────────────────────────────
  const regressionResult = applyRegressionToMean(
    marketBlend.adjustedLambdaHome,
    marketBlend.adjustedLambdaAway,
    homeWf.effectiveSampleSize,
    awayWf.effectiveSampleSize,
    input.league.avgGoals,
  );

  // ── Top scores (preliminary — from ensemble, refined below after meta-ensemble) ──
  const top = ensemble.top;
  const primaryCellPre = top[0]!;

  const primaryKeyPre   = `${primaryCellPre.home}-${primaryCellPre.away}`;
  const mcPrimary       = mc.exactScoreFreq.get(primaryKeyPre) ?? primaryCellPre.prob;

  const bl        = { lambdaHome: marketBlend.adjustedLambdaHome, lambdaAway: marketBlend.adjustedLambdaAway };
  const lambdaSum = bl.lambdaHome + bl.lambdaAway;
  const sigma     = skellamStd(bl.lambdaHome, bl.lambdaAway);
  const z         = noveltyZ(mcPrimary);

  // ── M31-33: Shot Quality & xG ─────────────────────────────────────────────
  const avgShotsH = Math.max(1, homeWf.rawAvgFor / 0.105);  // shots ≈ goals / conversion
  const avgShotsA = Math.max(1, awayWf.rawAvgFor / 0.105);
  const shotQualityResult = computeShotQuality({
    homeShotsPerMatch: avgShotsH,
    homeShotsOnTargetPerMatch: avgShotsH * 0.40,
    awayShotsPerMatch: avgShotsA,
    awayShotsOnTargetPerMatch: avgShotsA * 0.40,
    homeDefStrength: Math.max(0.4, Math.min(1.8, awayWf.defenseStrength)),
    awayDefStrength: Math.max(0.4, Math.min(1.8, homeWf.defenseStrength)),
    homeXgPerMatch: homeWf.rawAvgFor,
    awayXgPerMatch: awayWf.rawAvgFor,
    homeAttackStyle: homeTactical.style === "POSSESSION_HIGH_PRESS" ? "possession"
      : homeTactical.style === "COUNTER_ATTACK" ? "counter"
      : homeTactical.style === "DIRECT_LONG_BALL" ? "direct" : "balanced",
    awayAttackStyle: awayTactical.style === "POSSESSION_HIGH_PRESS" ? "possession"
      : awayTactical.style === "COUNTER_ATTACK" ? "counter"
      : awayTactical.style === "DIRECT_LONG_BALL" ? "direct" : "balanced",
  });

  // ── M34-36: Hawkes + Dixon-Robinson Live ──────────────────────────────────
  // FIX 12: Hawkes internally scales lambda by remaining fraction (baseRate = mu * remFrac).
  // bl.lambdaHome is already the remaining-time lambda in live mode (fullGameLambda * remFrac).
  // Passing it directly causes a double-scaling: fullGameLambda * remFrac * remFrac.
  // Recover the market-blended full-game lambda by dividing by remFrac.
  const hawkesLambdaFrac = isLive ? Math.max(0.01, (90 - liveState!.minute) / 90) : 1.0;
  const hawkesResult = computeHawkes({
    lambdaHome: bl.lambdaHome / hawkesLambdaFrac,
    lambdaAway: bl.lambdaAway / hawkesLambdaFrac,
    minutesElapsed: liveState?.minute ?? 0,
    currentHomeGoals: liveState?.homeScore ?? 0,
    currentAwayGoals: liveState?.awayScore ?? 0,
  });
  const drLive = liveState
    ? dixonRobinsonLive(bl.lambdaHome, bl.lambdaAway, liveState.minute, liveState.homeScore, liveState.awayScore)
    : null;

  // ── DR Live matrix for meta-ensemble (M36 — Dixon-Robinson integration) ──
  // dixonRobinsonLive returns situation-adjusted remaining-time lambdas.
  // Build a REMAINING-GOALS Poisson matrix from DR adjusted lambdas.
  // All other model matrices in the ensemble represent remaining goals (the
  // pipeline scales formLambdas by remFrac before building ensemble, so
  // every matrix is already in remaining-goals space). The final-score
  // display offset (liveOffsetHome/Away = current score) is added later.
  // DO NOT shift by the current score here — that would cause the display
  // code to double-count the current score (e.g. 0-3 + 3 remaining = 0-6).
  const drLiveMatrix = (liveState && drLive)
    ? poissonScoreMatrix(
        Math.max(0.001, drLive.adjustedLambdaHome),
        Math.max(0.001, drLive.adjustedLambdaAway),
        adaptiveMaxGoals,
      )
    : null;

  // ── M47-49: Copula Model ──────────────────────────────────────────────────
  const goalCorrelation = Math.max(-0.3, Math.min(0.4, ms.bivariateRho));
  const copulaResult = computeCopula({
    lambdaHome: bl.lambdaHome,
    lambdaAway: bl.lambdaAway,
    goalCorrelation,
    copulaType: "auto",
  });

  // ── M54-57: Live Bayesian Context ─────────────────────────────────────────
  // FIX: Pass fullGameLambdaHome/Away (the pre-live-scaling per-90-min rates) so
  // that computeLiveContext can correctly apply remainingFraction internally.
  // bl.lambdaHome is already scaled by remFrac — using it here would produce
  // a remFrac^2 shrinkage (double scaling), severely under-estimating remaining goals.
  const liveContextResult = liveState
    ? computeLiveContext({
        priorScoreMatrix: h2hBlendedMatrix,
        minutesElapsed: liveState.minute,
        currentHomeGoals: liveState.homeScore,
        currentAwayGoals: liveState.awayScore,
        homeRedCards:      liveState.homeRedCards ?? 0,
        awayRedCards:      liveState.awayRedCards ?? 0,
        homeSubstitutions: liveState.homeSubs ?? Math.floor(liveState.minute / 30),
        awaySubstitutions: liveState.awaySubs ?? Math.floor(liveState.minute / 30),
        liveHomeXg: liveState.homeXg,
        liveAwayXg: liveState.awayXg,
        baseLambdaHome: fullGameLambdaHome,
        baseLambdaAway: fullGameLambdaAway,
      })
    : null;

  // ── M58-60: Weibull Count + COM-Poisson ───────────────────────────────────
  // Fix 15: Weibull rho parameter was inverted.
  // Weibull Count (McShane et al 2008): rho < 1 = overdispersion, rho > 1 = underdispersion.
  // The old formula (goalVariance / rawAvgFor = variance/mean) gives rho > 1 when
  // variance > mean (overdispersed data — the typical football case), which tells the
  // Weibull model the data is underdispersed — the exact opposite of reality.
  // Fix: use mean/variance (same formula as COM-Poisson nu), which correctly maps
  // overdispersed data (variance > mean) → rho < 1 (Weibull overdispersion) ✓.
  const weibullResult = computeWeibullCount({
    lambdaHome: bl.lambdaHome,
    lambdaAway: bl.lambdaAway,
    rhoHome: Math.max(0.5, Math.min(1.5, homeWf.goalVariance > 0 ? homeWf.rawAvgFor / Math.max(0.1, homeWf.goalVariance) : 0.88)),
    rhoAway: Math.max(0.5, Math.min(1.5, awayWf.goalVariance > 0 ? awayWf.rawAvgFor / Math.max(0.1, awayWf.goalVariance) : 0.88)),
    nuHome: Math.max(0.5, Math.min(2.0, homeWf.rawAvgFor > 0 ? homeWf.rawAvgFor / Math.max(0.5, homeWf.goalVariance) : 0.92)),
    nuAway: Math.max(0.5, Math.min(2.0, awayWf.rawAvgFor > 0 ? awayWf.rawAvgFor / Math.max(0.5, awayWf.goalVariance) : 0.92)),
  });

  // ── M76-80: Scoreline Patterns ────────────────────────────────────────────
  const scorelineResult = computeScorelinePatterns({
    lambdaHome: bl.lambdaHome,
    lambdaAway: bl.lambdaAway,
    empiricalWeight: 0.18,
    leagueGoalFactor: input.league.avgGoals / 1.325,
  });

  // ── M65-70: Meta-Ensemble (stacking all model outputs) ────────────────────
  // When live, the Dixon-Robinson matrix receives extra weight (0.20) because
  // it has real-time situational adjustments that are highly informative in-play.
  // Scale down the other models proportionally to keep total = 1.0.
  const _drLiveWeight = drLiveMatrix ? 0.20 : 0;
  const _metaScale    = 1 - _drLiveWeight;
  const metaInput = {
    modelPredictions: [
      { modelId: "ensemble",     scoreMatrix: h2hBlendedMatrix,                     currentWeight: 0.35 * _metaScale },
      { modelId: "bayesHier",    scoreMatrix: bayesHierResult.scoreMatrix,           currentWeight: 0.15 * _metaScale },
      { modelId: "copula",       scoreMatrix: copulaResult.scoreMatrix,              currentWeight: 0.12 * _metaScale },
      { modelId: "weibullBlend", scoreMatrix: weibullResult.blendedScoreMatrix,      currentWeight: 0.10 * _metaScale },
      { modelId: "scoreline",    scoreMatrix: scorelineResult.blendedScoreMatrix,    currentWeight: 0.13 * _metaScale },
      { modelId: "xgShots",      scoreMatrix: shotQualityResult.scoreMatrix,         currentWeight: 0.15 * _metaScale },
      ...(drLiveMatrix ? [{ modelId: "drLive", scoreMatrix: drLiveMatrix, currentWeight: _drLiveWeight }] : []),
    ],
    topK: 12,
  };
  const metaEnsembleResult = computeMetaEnsemble(metaInput);

  // Merge meta-ensemble stacked matrix into final (blend 30% meta, 70% H2H-blended ensemble)
  let finalMatrix = h2hBlendedMatrix.map((row, h) =>
    row.map((p, a) => 0.70 * p + 0.30 * (metaEnsembleResult.stackedScoreMatrix[h]?.[a] ?? 0)),
  );

  // For live games, blend a remaining-goals Poisson matrix built from live-adjusted lambdas.
  // CRITICAL: finalMatrix is in REMAINING-GOALS space (lambdas were scaled by remFrac before
  // the ensemble). liveContextResult.posteriorScoreMatrix is in FINAL-SCORE space — those
  // two spaces are INCOMPATIBLE. Blending posteriorScoreMatrix directly into finalMatrix
  // corrupts the distribution: it zeros out the highest-probability remaining-goals cells
  // (small remaining counts like [0][0]) because they appear to be "impossible final scores",
  // and inflates low-probability cells (large remaining counts like [2][0]) because they
  // happen to match valid final scores. FIX: build a fresh Poisson remaining-goals matrix
  // from liveContextResult.remainingLambdaHome/Away, which already incorporate all live
  // adjustments (red cards M55, substitution impact M56, xG blend M54).
  if (liveContextResult) {
    const liveRemainMatrix = poissonScoreMatrix(
      Math.max(0.001, liveContextResult.remainingLambdaHome),
      Math.max(0.001, liveContextResult.remainingLambdaAway),
      adaptiveMaxGoals,
    );
    finalMatrix = finalMatrix.map((row, h) =>
      row.map((p, a) => 0.60 * p + 0.40 * (liveRemainMatrix[h]?.[a] ?? 0)),
    );
  }

  // Run MC on the fully-blended finalMatrix — this is the authoritative probability source
  const mcFinal = runMonteCarlo(finalMatrix, mcIterations);

  // Extract top-K scores from the final MC frequencies (sorted by probability)
  const topFinalMC = (() => {
    const entries: Array<{ home: number; away: number; prob: number }> = [];
    for (const [key, prob] of mcFinal.exactScoreFreq) {
      const [h, a] = key.split("-").map(Number);
      if (h !== undefined && a !== undefined && !isNaN(h) && !isNaN(a)) {
        entries.push({ home: h, away: a, prob });
      }
    }
    entries.sort((x, y) => y.prob - x.prob);
    return entries.slice(0, 20);
  })();

  // ── Borda Count rank aggregation — consensus across all Level-1 models ────
  // Rank aggregation is more robust than argmax of averaged probabilities:
  // it selects scores that appear near the top of MOST models rather than
  // those pushed high by a single outlier model (Constantinou & Fenton 2012).
  // The hybrid blend (72% MC probability + 28% Borda rank consensus) retains
  // well-calibrated absolute probabilities while correcting selection bias.
  const bordaScores = bordaCountRankAggregate(
    ensemble.models.map((m) => m.matrix),
    ensemble.models.map((m) => m.weight),
    20,
  );
  const topFinal = hybridRankProbScore(topFinalMC, bordaScores, 0.72).slice(0, 16);

  // ── Methods 25–27 + 30: Conformal, Entropy, Brier, Score Cluster ─────────
  // FIX 11: Compute on topFinal (post meta-ensemble + live blend) rather than
  // preliminary `top` (pre meta-ensemble). topFinal reflects the actual final
  // probability distribution — using it makes all diagnostics consistent with
  // the authoritative predictions surfaced to the user.
  const topForDiag = topFinal.length >= 4 ? topFinal : top;
  const conformalSetResult = computeConformalSet(topForDiag, 0.80);
  const entropyResult      = computeModelEntropy(topForDiag);
  const brierResult        = computeBrierDecomposition(topForDiag);
  const scoreClusterResult = analyzeScoreClusters(topForDiag);

  // ── Final authoritative predictions (meta+live blended) ──────────────────
  const topOutput = topFinal.length >= 4 ? topFinal : top;
  const primaryCell = topOutput[0]!;
  const hedge = topOutput.slice(1, 4);
  const primaryKeyFinal = `${primaryCell.home}-${primaryCell.away}`;
  const mcPrimaryFinal = mcFinal.exactScoreFreq.get(primaryKeyFinal) ?? primaryCell.prob;
  // FIX: zScore should reflect the final, authoritative probability — not the preliminary mc.
  // mcPrimaryFinal incorporates meta-ensemble + live-context blending; mcPrimary did not.
  const zFinal = noveltyZ(mcPrimaryFinal);
  const primaryTotalFinal = primaryCell.home + primaryCell.away;
  const protectionCandidate = topOutput.slice(1).find((c) => Math.abs((c.home + c.away) - primaryTotalFinal) <= 1) ?? topOutput[1] ?? primaryCell;
  const protectionVariant = {
    home: protectionCandidate.home,
    away: protectionCandidate.away,
    prob: mcFinal.exactScoreFreq.get(`${protectionCandidate.home}-${protectionCandidate.away}`) ?? protectionCandidate.prob,
  };
  const dispPH = primaryCell.home + liveOffsetHome;
  const dispPA = primaryCell.away + liveOffsetAway;
  const dispProtH = protectionVariant.home + liveOffsetHome;
  const dispProtA = protectionVariant.away + liveOffsetAway;

  // ── M50-53: Market Intelligence (when odds are available) ─────────────────
  // FIX: use mcFinal probabilities (post meta-ensemble + live blend) for edge detection.
  // The preliminary `mc` was computed from marketBlend.matrix before meta-ensemble
  // and live-context blending — using it for CLV/edge computation produced stale model probs.
  const marketIntelResult = input.marketOdds
    ? computeMarketIntelligence({
        books: [{
          homeWinOdds: input.marketOdds.oneX2?.homeOdd,
          drawOdds:    input.marketOdds.oneX2?.drawOdd,
          awayWinOdds: input.marketOdds.oneX2?.awayOdd,
          ouLine:      input.marketOdds.overUnder?.[0]?.line,
          overOdds:    input.marketOdds.overUnder?.[0]?.overOdd,
          underOdds:   input.marketOdds.overUnder?.[0]?.underOdd,
          bookName: "market",
        } as MarketIntelOdds],
        modelHomeWin: mcFinal.homeWinProb,
        modelDraw: mcFinal.drawProb,
        modelAwayWin: mcFinal.awayWinProb,
        modelExpectedGoals: lambdaSum,
        modelTopScores: topOutput.slice(0, 10),
      })
    : null;

  // ── Pythagorean (Method 21) ───────────────────────────────────────────────
  const pyth = pythagoreanExpectation(
    homeWf.rawAvgFor, homeWf.rawAvgAgainst,
    awayWf.rawAvgFor, awayWf.rawAvgAgainst,
  );

  // ── Kelly (Method 22) ─────────────────────────────────────────────────────
  const fairOddPrimary = 1 / Math.max(1e-6, mcPrimaryFinal);
  const kellyPrimary   = computeKelly(mcPrimaryFinal, fairOddPrimary);

  // Kelly Top-3 (using fair odds — full analysis with external odds when available)
  const kellyTopScoresRaw = kellyForTopN(topOutput.slice(0, 5), {}, 0);
  const kellyTopScoresOut = kellyTopScoresRaw.map((c) => ({
    score:        `${c.home + liveOffsetHome}-${c.away + liveOffsetAway}`,
    prob:         c.prob,
    fairOdd:      1 / Math.max(1e-6, c.prob),
    quarterKelly: c.kelly?.quarterKelly ?? 0,
    hasEdge:      c.kelly?.hasEdge ?? false,
  }));

  // ── Live Markov (Method 23) ───────────────────────────────────────────────
  const preLiveLambdaHome = liveState
    ? formLambdas.lambdaHome / Math.max(0.01, (90 - liveState.minute) / 90) : formLambdas.lambdaHome;
  const preLiveLambdaAway = liveState
    ? formLambdas.lambdaAway / Math.max(0.01, (90 - liveState.minute) / 90) : formLambdas.lambdaAway;

  const liveMarkovResult = liveState
    ? markovProjectedFinal({
        lambdaHome: Math.min(8, preLiveLambdaHome),
        lambdaAway: Math.min(8, preLiveLambdaAway),
        minutesElapsed: liveState.minute,
        currentHome: liveState.homeScore,
        currentAway: liveState.awayScore,
      })
    : null;

  const liveMarkov = liveMarkovResult?.homeWinProb !== undefined
    ? {
        homeWinProb: liveMarkovResult.homeWinProb,
        drawProb:    liveMarkovResult.drawProb!,
        awayWinProb: liveMarkovResult.awayWinProb!,
        remainingGoalsHome: liveMarkovResult.remainingGoalsHome,
        remainingGoalsAway: liveMarkovResult.remainingGoalsAway,
      }
    : null;

  // ── Live mcStats anchoring ────────────────────────────────────────────────
  // mcFinal is computed from the remaining-goals matrix — its over/BTTS stats
  // are relative to REMAINING goals, not the final total goals. For live games,
  // override with score-anchored values so the UI shows correct market signals.
  const liveMcStats = (() => {
    if (!liveState) return mcFinal;
    const curH = liveState.homeScore;
    const curA = liveState.awayScore;
    const curTotal = curH + curA;
    // Use live-adjusted remaining lambdas when available (includes red cards + subs)
    const remLH = Math.max(0.001, liveContextResult?.remainingLambdaHome ?? formLambdas.lambdaHome);
    const remLA = Math.max(0.001, liveContextResult?.remainingLambdaAway ?? formLambdas.lambdaAway);
    const remSum = remLH + remLA;
    const pNoMoreH = Math.exp(-remLH);
    const pNoMoreA = Math.exp(-remLA);
    const pMoreH = 1 - pNoMoreH;
    const pMoreA = 1 - pNoMoreA;

    // BTTS: both teams score ≥ 1 goal in the FINAL score
    const bttsAnchor =
      curH > 0 && curA > 0 ? 1.0           // already achieved
      : curH > 0 && curA === 0 ? pMoreA     // home scored, need away to score
      : curH === 0 && curA > 0 ? pMoreH     // away scored, need home to score
      : pMoreH * pMoreA;                    // neither yet

    // Over/Under: anchored to total final goals (current + remaining)
    // P(final total > line) — compute via Poisson CDF on remaining sum
    const poissonCDF = (lambda: number, maxK: number) => {
      let cdf = 0; let term = Math.exp(-lambda);
      for (let k = 0; k <= maxK; k++) {
        cdf += term;
        term *= lambda / (k + 1);
      }
      return cdf;
    };
    const over15Anchor = curTotal >= 2 ? 1.0
      : curTotal === 1 ? 1 - poissonCDF(remSum, 0)       // need ≥1 more
      : 1 - poissonCDF(remSum, 1);                        // need ≥2 more (0 now)
    const over25Anchor = curTotal >= 3 ? 1.0
      : curTotal === 2 ? 1 - poissonCDF(remSum, 0)        // need ≥1 more
      : curTotal === 1 ? 1 - poissonCDF(remSum, 1)        // need ≥2 more
      : 1 - poissonCDF(remSum, 2);                        // need ≥3 more (0 now)

    // 1X2: Markov chain is explicitly score-anchored → prefer it
    const homeWinAnchor = liveMarkovResult?.homeWinProb ?? mcFinal.homeWinProb;
    const drawAnchor    = liveMarkovResult?.drawProb    ?? mcFinal.drawProb;
    const awayWinAnchor = liveMarkovResult?.awayWinProb ?? mcFinal.awayWinProb;

    // avgTotalGoals: expected remaining + current
    const avgTotalAnchor = curTotal + remLH + remLA;

    return {
      ...mcFinal,
      bttsProb:    bttsAnchor,
      over15:      over15Anchor,
      over25:      over25Anchor,
      homeWinProb: homeWinAnchor,
      drawProb:    drawAnchor,
      awayWinProb: awayWinAnchor,
      avgTotalGoals: avgTotalAnchor,
    };
  })();

  // ── Markov timeline ───────────────────────────────────────────────────────
  const proj = markovProjectedFinal({ lambdaHome: bl.lambdaHome, lambdaAway: bl.lambdaAway });
  const timelineFlow = {
    start: isLive
      ? `AO VIVO ${liveState!.minute}' — ${liveState!.homeScore}-${liveState!.awayScore} | λ rem. Σ=${lambdaSum.toFixed(2)}`
      : lambdaSum > 3.5 ? "Ritmo explosivo — gol antes do 20' provável"
        : lambdaSum > 2.5 ? "Ritmo alto — abertura antes do 30'"
          : lambdaSum > 1.8 ? "Ritmo moderado — disputa tática"
            : "Ritmo baixo — defesa prioritária",
    ht: isLive
      ? `Atual: ${liveState!.homeScore}-${liveState!.awayScore} @ ${liveState!.minute}' | FT proj. ${dispPH}-${dispPA}`
      : `HT proj. ${(proj.projectedHome / 2).toFixed(1)}-${(proj.projectedAway / 2).toFixed(1)} | Over 0.5HT: ${(mc.over15 * 0.6 * 100).toFixed(0)}%`,
    m75: `${dispPH}-${dispPA} tendência @ 75' | Proteção: ${dispProtH}-${dispProtA}`,
    ft:  isLive
      ? `FT proj. ${dispPH}-${dispPA} | λΣ=${lambdaSum.toFixed(2)}`
      : `FT proj. ${proj.projectedHome.toFixed(2)}-${proj.projectedAway.toFixed(2)} | λΣ=${lambdaSum.toFixed(2)}`,
  };

  // ── X-RAY driver text ─────────────────────────────────────────────────────
  const driverParts: string[] = [];
  const eloDiff = input.homeElo - input.awayElo;

  if (eloDiff > 150) driverParts.push(`Elo +${eloDiff.toFixed(0)} → ${input.homeTeamName} grande favorito`);
  else if (eloDiff < -150) driverParts.push(`Elo +${(-eloDiff).toFixed(0)} → ${input.awayTeamName} visitante favorito`);
  else if (Math.abs(eloDiff) < 30) driverParts.push(`Equilíbrio Elo (Δ=${eloDiff.toFixed(0)}) — disputa aberta`);
  else driverParts.push(`Elo Δ ${eloDiff > 0 ? "+" : ""}${eloDiff.toFixed(0)} → ${eloDiff > 0 ? input.homeTeamName : input.awayTeamName}`);

  if (homeAttack > 1.25) driverParts.push(`${input.homeTeamName} ATQ ${(homeAttack * 100 - 100).toFixed(0)}% acima da média`);
  else if (homeAttack < 0.80) driverParts.push(`${input.homeTeamName} ATQ ${(100 - homeAttack * 100).toFixed(0)}% abaixo da média`);
  if (awayAttack > 1.25) driverParts.push(`${input.awayTeamName} ATQ ${(awayAttack * 100 - 100).toFixed(0)}% acima da média`);
  else if (awayAttack < 0.80) driverParts.push(`${input.awayTeamName} ATQ ${(100 - awayAttack * 100).toFixed(0)}% abaixo da média`);
  if (homeDefense < 0.75) driverParts.push(`Defesa ${input.homeTeamName} sólida (DEF −${(100 - homeDefense * 100).toFixed(0)}%)`);
  if (awayDefense < 0.75) driverParts.push(`Defesa ${input.awayTeamName} sólida (DEF −${(100 - awayDefense * 100).toFixed(0)}%)`);
  if (homeDefense > 1.3)  driverParts.push(`Defesa ${input.homeTeamName} vulnerável (DEF +${(homeDefense * 100 - 100).toFixed(0)}%)`);
  if (awayDefense > 1.3)  driverParts.push(`Defesa ${input.awayTeamName} vulnerável (DEF +${(awayDefense * 100 - 100).toFixed(0)}%)`);

  if (Math.abs(homeWf.formTrend) >= 0.25)
    driverParts.push(`${input.homeTeamName} em ${trendLabel(homeWf.formTrend)} (trend ${homeWf.formTrend > 0 ? "+" : ""}${(homeWf.formTrend * 100).toFixed(0)}%)`);
  if (Math.abs(awayWf.formTrend) >= 0.25)
    driverParts.push(`${input.awayTeamName} em ${trendLabel(awayWf.formTrend)} (trend ${awayWf.formTrend > 0 ? "+" : ""}${(awayWf.formTrend * 100).toFixed(0)}%)`);

  // Tactical matchup driver
  driverParts.push(`Tático: ${tacticalMatchupResult.matchupLabel}`);

  // SOS driver
  if (Math.abs(homeSOS.sosIndex - 1.0) > 0.15 || Math.abs(awaySOS.sosIndex - 1.0) > 0.15) {
    driverParts.push(`SOS: ${input.homeTeamName} agenda ${homeSOS.scheduleLabel} | ${input.awayTeamName} agenda ${awaySOS.scheduleLabel}`);
  }

  // Derby driver
  if (derbyFactor.isDerby) {
    driverParts.push(`Derby detectado: ${(derbyFactor.h2hDrawRate * 100).toFixed(0)}% empates H2H, avg ${derbyFactor.h2hAvgGoals.toFixed(1)} gols`);
  }

  // Momentum driver
  if (Math.abs(homeMomentum.momentumScore - 1.0) > 0.15)
    driverParts.push(`${input.homeTeamName} momentum: ${homeMomentum.label}`);
  if (Math.abs(awayMomentum.momentumScore - 1.0) > 0.15)
    driverParts.push(`${input.awayTeamName} momentum: ${awayMomentum.label}`);

  // Pressure driver
  if (homePressure.estimatedZone === "relegation" || homePressure.estimatedZone === "lower")
    driverParts.push(`${input.homeTeamName} zona ${homePressure.estimatedZone} — jogo de pressão`);
  if (awayPressure.estimatedZone === "title")
    driverParts.push(`${input.awayTeamName} briga pelo título — jogo concentrado`);

  // Entropy/cluster driver
  driverParts.push(`Entropia: ${entropyResult.label} | Cluster: ${scoreClusterResult.riskLabel}`);

  // Critical X-RAY flags
  const criticalFlags = xRayFlagObjects.filter((f) => f.severity === "CRITICA");
  const altaFlags     = xRayFlagObjects.filter((f) => f.severity === "ALTA");
  for (const f of criticalFlags.slice(0, 2))
    driverParts.push(`⚑ ${f.code}: ${f.label.split(" — ")[1] ?? f.label}`);
  for (const f of altaFlags.slice(0, 1))
    driverParts.push(`◆ ${f.code}: ${f.label.split(" — ")[1] ?? f.label}`);

  if (driverParts.length === 0)
    driverParts.push("Convergência multi-modelo em equilíbrio — palpite emergiu estatisticamente");

  driverParts.push(`λ blend: ${input.homeTeamName} ${bl.lambdaHome.toFixed(2)} | ${input.awayTeamName} ${bl.lambdaAway.toFixed(2)} | σ ${sigma.toFixed(2)}`);

  // ── Context notes ─────────────────────────────────────────────────────────
  const tactNotes: string[] = [];

  const restDiff = Math.abs(input.daysRestHome - input.daysRestAway);
  if (restDiff >= 3)
    tactNotes.push(`Disparidade de descanso: ${input.homeTeamName} ${input.daysRestHome}d vs ${input.awayTeamName} ${input.daysRestAway}d`);
  if (input.daysRestHome <= 2 || input.daysRestAway <= 2)
    tactNotes.push("Fadiga elevada detectada — lambda ajustado (−5–8%)");
  if (homeWf.effectiveSampleSize < 4 || awayWf.effectiveSampleSize < 4)
    tactNotes.push("Amostra reduzida — Bayesian shrinkage pseudo=8 aplicado");
  if (h2hData)
    tactNotes.push(`H2H blend ativo: ${h2hData.sampleSize} confrontos — avg ${h2hData.avgH2HHome.toFixed(2)}-${h2hData.avgH2HAway.toFixed(2)}`);
  if (input.weather) {
    if (input.weather.precipitationMm > 5)
      tactNotes.push(`Precipitação ${input.weather.precipitationMm.toFixed(1)}mm — viés Under (×${weatherMultiplier(input.weather).toFixed(2)})`);
    if (input.weather.windKph > 35)
      tactNotes.push(`Vento ${input.weather.windKph.toFixed(0)} km/h — degradação de jogo aéreo`);
  }
  if (homeVenueSplit.homeSampleSize >= 3)
    tactNotes.push(`Venue-split: ${input.homeTeamName} ATQ-casa ${homeVenueSplit.homeCtx.attackStrength.toFixed(2)}x | ${input.awayTeamName} ATQ-fora ${awayVenueSplit.awayCtx.attackStrength.toFixed(2)}x`);
  if (homeWf.cleanSheetRate >= 0.4)
    tactNotes.push(`${input.homeTeamName}: ${Math.round(homeWf.cleanSheetRate * 100)}% clean sheets — defesa sólida confirmada`);
  if (awayWf.cleanSheetRate >= 0.4)
    tactNotes.push(`${input.awayTeamName}: ${Math.round(awayWf.cleanSheetRate * 100)}% clean sheets — defesa sólida confirmada`);
  if (homeWf.failedToScoreRate >= 0.4)
    tactNotes.push(`${input.homeTeamName}: ${Math.round(homeWf.failedToScoreRate * 100)}% jogos sem marcar — ZIP/Hurdle ajusta P(0-X)`);
  if (awayWf.failedToScoreRate >= 0.4)
    tactNotes.push(`${input.awayTeamName}: ${Math.round(awayWf.failedToScoreRate * 100)}% jogos sem marcar — ZIP/Hurdle ajusta P(X-0)`);
  if (homeResilience.isResilient)
    tactNotes.push(`${input.homeTeamName}: equipa resiliente (comeback rate ${Math.round(homeResilience.comebackRate * 100)}%) — força em jogos adversos`);
  if (awayResilience.isResilient)
    tactNotes.push(`${input.awayTeamName}: equipa resiliente (comeback rate ${Math.round(awayResilience.comebackRate * 100)}%) — força em jogos adversos`);

  // Conformal/entropy notes
  tactNotes.push(`Conjunto conformal (80%): ${conformalSetResult.scores.slice(0, 5).join(", ")}${conformalSetResult.scores.length > 5 ? "…" : ""} (${conformalSetResult.setSize} placares)`);
  tactNotes.push(`Regressão à média: ${(regressionResult.regressionCoefficient * 100).toFixed(0)}% | λ regr. Casa ${regressionResult.adjustedLambdaHome.toFixed(2)} Fora ${regressionResult.adjustedLambdaAway.toFixed(2)}`);
  tactNotes.push(`BMA convergência: ${(ensemble.bmaAgreement * 100).toFixed(1)}% | Entropia normalizada: ${(entropyResult.normalizedEntropy * 100).toFixed(0)}%`);
  tactNotes.push(`Score Gravity: prior ${(gravityWeight * 100).toFixed(0)}% | NegBin α Casa ${(alphaFromWf(homeWf)).toFixed(2)} Fora ${(alphaFromWf(awayWf)).toFixed(2)}`);
  tactNotes.push(`Double Poisson θ: Casa ${(thetaFromWf(homeWf)).toFixed(2)} Fora ${(thetaFromWf(awayWf)).toFixed(2)} (θ<1=underdispersed, θ>1=overdispersed)`);
  tactNotes.push(`Monte Carlo: ${mc.iterations.toLocaleString("pt-BR")} iter. | maxGols=${adaptiveMaxGoals} | Conv: ${(ensemble.convergence * 100).toFixed(1)}%`);
  tactNotes.push(`Dixon-Coles τ=${ms.dixonColesTau.toFixed(3)} | ρ=${ms.bivariateRho.toFixed(3)} | HA=${ms.homeAdvantage.toFixed(3)}`);
  tactNotes.push(`Form Trend: ${input.homeTeamName} ${homeWf.formTrend >= 0 ? "+" : ""}${(homeWf.formTrend * 100).toFixed(0)}% | ${input.awayTeamName} ${awayWf.formTrend >= 0 ? "+" : ""}${(awayWf.formTrend * 100).toFixed(0)}%`);
  if (marketBlend.channelsApplied.length > 0)
    tactNotes.push(`Market Blend: [${marketBlend.channelsApplied.join(", ")}] | inf. ${marketBlend.marketInfluencePct.toFixed(0)}%`);

  // ── Verdict ───────────────────────────────────────────────────────────────
  const inconclusiveReasons: string[] = [];
  if (mcPrimaryFinal < thresholds.minAssertiveness)
    inconclusiveReasons.push(`Assertividade ${(mcPrimaryFinal * 100).toFixed(1)}% < ${(thresholds.minAssertiveness * 100).toFixed(0)}%`);
  if (ensemble.convergence < thresholds.minConvergence)
    inconclusiveReasons.push(`Convergência ${(ensemble.convergence * 100).toFixed(1)}% < ${(thresholds.minConvergence * 100).toFixed(0)}%`);
  if (input.homeHistory.length < 3 || input.awayHistory.length < 3)
    inconclusiveReasons.push("Histórico insuficiente (< 3 jogos por time)");

  const verdict: "SINGULARITY" | "INCONCLUSIVE" = inconclusiveReasons.length === 0 ? "SINGULARITY" : "INCONCLUSIVE";

  const homeForm    = summariseForm(input.homeTeamName, input.homeHistory, input.homeElo, input.daysRestHome, ms.weightedFormXi);
  const awayForm    = summariseForm(input.awayTeamName, input.awayHistory, input.awayElo, input.daysRestAway, ms.weightedFormXi);
  const h2hSummary  = summariseH2H(input.h2hSample);
  const modelBreakdown = ensemble.models.map((m) => ({ model: m.name, topScore: `${m.topScore.home}-${m.topScore.away}`, topProb: m.topScore.prob, weight: m.weight }));

  const motorsOut = isLive ? ["AO VIVO (adaptação in-play)", ...ALL_MOTORS] : ALL_MOTORS;
  const liveContextNote = isLive
    ? [`AO VIVO: ${liveState!.homeScore}-${liveState!.awayScore} @ ${liveState!.minute}' | Gols restantes λΣ=${lambdaSum.toFixed(2)}`]
    : [];

  // Estimated PPG from pressure (for output)
  const ppgFromHistory = (h: PastMatch[]) => {
    const r = h.slice(0, 7);
    if (r.length === 0) return 1.5;
    return r.reduce((s, m) => s + (m.goalsFor > m.goalsAgainst ? 3 : m.goalsFor === m.goalsAgainst ? 1 : 0), 0) / r.length;
  };

  // ── DATA CROSSING: Cross-Model Consensus + Markov Cross-Validation ────────
  // "Extreme precision via data crossing": boost scores that are independently
  // confirmed by multiple model families. Scores appearing near the top of
  // many individual models (high consensus) and matching the Markov remaining-
  // goals projection receive amplification. This is the final selection gate
  // before the predictions are surfaced to the user.
  //
  // Method: for each score in topOutput (remaining-goals space), measure:
  //   1. Weighted cross-model presence ratio across all Level-1 model matrices
  //   2. Meta-ensemble stack agreement (independent second-opinion)
  //   3. Markov projection proximity (live games only)
  //   4. Score gravity / empirical football prior alignment
  // All signals are fused into a consensus bonus (max +30%) applied to the
  // model probability, then renormalised.
  const crossedOutput = (() => {
    if (topOutput.length === 0) return topOutput;

    const modelMxs    = ensemble.models.map((m) => m.matrix);
    const modelWts    = ensemble.models.map((m) => m.weight);

    // Build weighted-top-8 presence sets for each Level-1 model (remaining-goals space)
    const modelTopSets: Set<string>[] = modelMxs.map((mx) => {
      const entries: { key: string; prob: number }[] = [];
      for (let h = 0; h < mx.length; h++) {
        const row = mx[h]!;
        for (let a = 0; a < row.length; a++) {
          const p = row[a] ?? 0;
          if (p > 0) entries.push({ key: `${h}-${a}`, prob: p });
        }
      }
      entries.sort((x, y) => y.prob - x.prob);
      return new Set(entries.slice(0, 8).map((e) => e.key));
    });

    // Meta-ensemble top-8: independent stacked second opinion
    const metaTopSet = new Set<string>();
    {
      const mx = metaEnsembleResult.stackedScoreMatrix;
      const entries: { key: string; prob: number }[] = [];
      for (let h = 0; h < mx.length; h++) {
        const row = mx[h]!;
        for (let a = 0; a < row.length; a++) {
          const p = row[a] ?? 0;
          if (p > 0) entries.push({ key: `${h}-${a}`, prob: p });
        }
      }
      entries.sort((x, y) => y.prob - x.prob);
      entries.slice(0, 8).forEach((e) => metaTopSet.add(e.key));
    }

    // Scoreline-patterns top-8 (empirical football distribution — independent prior)
    const scorelineTopSet = new Set<string>();
    {
      const mx = scorelineResult.blendedScoreMatrix;
      const entries: { key: string; prob: number }[] = [];
      for (let h = 0; h < mx.length; h++) {
        const row = mx[h]!;
        for (let a = 0; a < row.length; a++) {
          const p = row[a] ?? 0;
          if (p > 0) entries.push({ key: `${h}-${a}`, prob: p });
        }
      }
      entries.sort((x, y) => y.prob - x.prob);
      entries.slice(0, 8).forEach((e) => scorelineTopSet.add(e.key));
    }

    // Markov remaining-goals proximity set (live only, remaining-goals space)
    const markovRemSet = new Set<string>();
    if (liveMarkov && liveState) {
      const rH = liveMarkov.remainingGoalsHome;
      const rA = liveMarkov.remainingGoalsAway;
      for (let dh = -1; dh <= 2; dh++) {
        for (let da = -1; da <= 2; da++) {
          const h = Math.max(0, Math.round(rH) + dh);
          const a = Math.max(0, Math.round(rA) + da);
          markovRemSet.add(`${h}-${a}`);
        }
      }
    }

    // H2H-MC top-8: recurrence prior (scores that occurred in H2H meetings)
    const h2hTopSet = new Set<string>();
    {
      const mx = h2hBlendedMatrix;
      const entries: { key: string; prob: number }[] = [];
      for (let h = 0; h < mx.length; h++) {
        const row = mx[h]!;
        for (let a = 0; a < row.length; a++) {
          const p = row[a] ?? 0;
          if (p > 0) entries.push({ key: `${h}-${a}`, prob: p });
        }
      }
      entries.sort((x, y) => y.prob - x.prob);
      entries.slice(0, 8).forEach((e) => h2hTopSet.add(e.key));
    }

    const boosted = topOutput.map((score) => {
      const key = `${score.home}-${score.away}`;

      // Weighted cross-model agreement (0..1)
      let totalW = 0, agreeW = 0;
      for (let i = 0; i < modelMxs.length; i++) {
        const w = modelWts[i] ?? (1 / modelMxs.length);
        totalW += w;
        if (modelTopSets[i]!.has(key)) agreeW += w;
      }
      const consensusRatio = totalW > 0 ? agreeW / totalW : 0;
      // Amplification starts above 25% weighted agreement, maxes out at 100% agreement
      const consensusBonus = Math.max(0, (consensusRatio - 0.25) / 0.75) * 0.20;

      // Meta-ensemble independent agreement (+6%)
      const metaBonus = metaTopSet.has(key) ? 0.06 : 0;

      // Scoreline / empirical prior agreement (+4%)
      const scorelineBonus = scorelineTopSet.has(key) ? 0.04 : 0;

      // H2H recurrence agreement (+5%)
      const h2hBonus = h2hTopSet.has(key) ? 0.05 : 0;

      // Markov cross-validation for live games (+10% exact, +4% adjacent)
      let markovBonus = 0;
      if (liveState && liveMarkov) {
        if (markovRemSet.has(key)) {
          const rH = Math.round(liveMarkov.remainingGoalsHome);
          const rA = Math.round(liveMarkov.remainingGoalsAway);
          markovBonus = (score.home === rH && score.away === rA) ? 0.10 : 0.04;
        }
      }

      // Advanced V2 multi-signal consensus bonus (M81-M110) — max +8%
      const advV2Bonus = advancedV2Result.additionalContextBonus;

      const totalBonus = consensusBonus + metaBonus + scorelineBonus + h2hBonus + markovBonus + advV2Bonus;
      return { ...score, prob: score.prob * (1 + totalBonus) };
    });

    // Renormalize
    const total = boosted.reduce((s, c) => s + c.prob, 0);
    if (total > 0) for (const b of boosted) b.prob /= total;
    boosted.sort((x, y) => y.prob - x.prob);
    return boosted;
  })();

  // crossedOutput is now the authoritative prediction list (data-crossing applied)
  const finalTopN = crossedOutput;

  return {
    fixtureId: input.fixtureId,
    leagueId:  input.league.id,
    leagueName: input.league.name,
    homeTeam:  input.homeTeamName,
    awayTeam:  input.awayTeamName,
    kickoffUtc: input.kickoffUtc.toISOString(),
    kickoffBrasilia: brasiliaTime(input.kickoffUtc),
    status: isLive ? "in_progress" : "scheduled",
    verdict,
    primary: { home: dispPH, away: dispPA, prob: mcPrimaryFinal, odd: null },
    protectionVariant: { home: dispProtH, away: dispProtA, prob: protectionVariant.prob },
    hedge: hedge.map((c) => ({ home: c.home + liveOffsetHome, away: c.away + liveOffsetAway, prob: c.prob, odd: null })),
    topN:  finalTopN.map((c)  => ({ home: c.home  + liveOffsetHome, away: c.away  + liveOffsetAway, prob: c.prob })),
    assertivenessReal:   mcPrimaryFinal,
    ensembleConvergence: ensemble.convergence,
    currentOdd: null,
    fairValue: 1 / Math.max(1e-6, mcPrimaryFinal),
    edgePct: null,
    zScore: zFinal,
    sindicatedVolume: null,
    xRayDriver: driverParts.join(" | "),
    xRayFlags,
    timelineFlow,
    forensicVerdict: ["NENHUMA"],
    motorsActivated: motorsOut,
    contextNotes: [
      ...liveContextNote,
      ...(inconclusiveReasons.length > 0 ? inconclusiveReasons.map((r) => `INCONCLUSIVO: ${r}`) : []),
      ...tactNotes,
    ],
    weather: input.weather,
    homeForm, awayForm, h2hSummary, modelBreakdown,
    mcStats: {
      homeWinProb: liveMcStats.homeWinProb, drawProb: liveMcStats.drawProb, awayWinProb: liveMcStats.awayWinProb,
      over15: liveMcStats.over15, over25: liveMcStats.over25, bttsProb: liveMcStats.bttsProb, avgTotalGoals: liveMcStats.avgTotalGoals,
    },
    pythagorean: pyth,
    kellyPrimary,
    kellyTopScores: kellyTopScoresOut,
    liveMarkov,
    bettingMarkets: null,
    isLive,
    liveMinute:    liveState?.minute     ?? null,
    liveHomeScore: liveState?.homeScore  ?? null,
    liveAwayScore: liveState?.awayScore  ?? null,
    sosAnalysis: {
      homeSOSIndex:     homeSOS.sosIndex,
      awaySOSIndex:     awaySOS.sosIndex,
      homeScheduleLabel: homeSOS.scheduleLabel,
      awayScheduleLabel: awaySOS.scheduleLabel,
      lambdaAdjApplied: Math.abs(homeSOS.sosIndex - 1.0) > 0.05 || Math.abs(awaySOS.sosIndex - 1.0) > 0.05,
    },
    tacticalMatchup: {
      homeStyle:           homeTactical.style,
      awayStyle:           awayTactical.style,
      matchupLabel:        tacticalMatchupResult.matchupLabel,
      isDefensiveClash:    tacticalMatchupResult.isDefensiveClash,
      isHighScoringExpected: tacticalMatchupResult.isHighScoringExpected,
      setPieceImportance:  tacticalMatchupResult.setPieceImportance,
      lambdaHomeAdj:       tacticalMatchupResult.lambdaHomeAdj,
      lambdaAwayAdj:       tacticalMatchupResult.lambdaAwayAdj,
    },
    derbyFactor: {
      isDerby:      derbyFactor.isDerby,
      h2hDrawRate:  derbyFactor.h2hDrawRate,
      h2hAvgGoals:  derbyFactor.h2hAvgGoals,
      lambdaAdj:    derbyFactor.lambdaAdj,
      drawBoost:    derbyFactor.drawBoost,
    },
    momentumCarry: {
      homeMomentum: homeMomentum.momentumScore,
      awayMomentum: awayMomentum.momentumScore,
      homeLabel:    homeMomentum.label,
      awayLabel:    awayMomentum.label,
    },
    probabilisticAnalysis: {
      conformalSet:       conformalSetResult.scores,
      conformalCoverage:  conformalSetResult.actualCoverage,
      conformalSetSize:   conformalSetResult.setSize,
      modelEntropy:       entropyResult.entropy,
      normalizedEntropy:  entropyResult.normalizedEntropy,
      entropyLabel:       entropyResult.label,
      brierSkillScore:    brierResult.skillScore,
    },
    regressionToMean: {
      coefficient:          regressionResult.regressionCoefficient,
      adjustedLambdaHome:   regressionResult.adjustedLambdaHome,
      adjustedLambdaAway:   regressionResult.adjustedLambdaAway,
    },
    bmaAgreement: ensemble.bmaAgreement,
    scoreCluster: {
      isTightCluster: scoreClusterResult.isTightCluster,
      topSpread:      scoreClusterResult.topSpread,
      dominantZone:   scoreClusterResult.dominantZone,
      riskLabel:      scoreClusterResult.riskLabel,
    },
    leaguePressure: {
      homeZone: homePressure.estimatedZone,
      awayZone: awayPressure.estimatedZone,
      homePPG:  ppgFromHistory(input.homeHistory),
      awayPPG:  ppgFromHistory(input.awayHistory),
    },
    resilience: {
      homeIsResilient:    homeResilience.isResilient,
      awayIsResilient:    awayResilience.isResilient,
      homeComebackRate:   homeResilience.comebackRate,
      awayComebackRate:   awayResilience.comebackRate,
    },
    // ─── NEW: 50 additional methods ──────────────────────────────────────────
    shotQuality: {
      xgLambdaHome:       shotQualityResult.xgLambdaHome,
      xgLambdaAway:       shotQualityResult.xgLambdaAway,
      homeXgPerShot:      shotQualityResult.homeXgPerShot,
      awayXgPerShot:      shotQualityResult.awayXgPerShot,
      homeConversionRate: shotQualityResult.homeConversionRate,
      awayConversionRate: shotQualityResult.awayConversionRate,
    },
    hawkesAnalysis: {
      projectedHome:    hawkesResult.projectedHome,
      projectedAway:    hawkesResult.projectedAway,
      probAnotherGoal:  hawkesResult.probAnotherGoal,
      hawkesAlpha:      hawkesResult.alpha,
      hawkesBeta:       hawkesResult.beta,
      situationalState: drLive?.situationalState,
      drLambdaHome:     drLive?.adjustedLambdaHome,
      drLambdaAway:     drLive?.adjustedLambdaAway,
    },
    fatigueAnalysis: {
      homeFatigueMultiplier: fatigueResult.homeFatigueMultiplier,
      awayFatigueMultiplier: fatigueResult.awayFatigueMultiplier,
      homeFatigueIndex:      fatigueResult.homeFatigueIndex,
      awayFatigueIndex:      fatigueResult.awayFatigueIndex,
      homeRotationRisk:      fatigueResult.homeRotationRisk,
      awayRotationRisk:      fatigueResult.awayRotationRisk,
      alerts:                fatigueResult.alerts,
    },
    setPieceAnalysis: {
      deltaLambdaHome:          setPieceResult.deltaLambdaHome,
      deltaLambdaAway:          setPieceResult.deltaLambdaAway,
      homeCornerGoals:          setPieceResult.homeCornerGoals,
      awayCornerGoals:          setPieceResult.awayCornerGoals,
      weatherMultiplier:        setPieceResult.weatherMultiplier,
      weatherDescription:       setPieceResult.weatherDescription,
      refereeDisruptionFactor:  setPieceResult.refereeDisruptionFactor,
      homeSetPieceDominance:    setPieceResult.homeSetPieceDominance,
      awaySetPieceDominance:    setPieceResult.awaySetPieceDominance,
    },
    bayesHierarchical: {
      posteriorLambdaHome: bayesHierResult.posteriorLambdaHome,
      posteriorLambdaAway: bayesHierResult.posteriorLambdaAway,
      homeAttackRank:      bayesHierResult.homeAttackRank,
      awayDefenseRank:     bayesHierResult.awayDefenseRank,
      homeShrinkage:       bayesHierResult.homeShrinkage,
      awayShrinkage:       bayesHierResult.awayShrinkage,
    },
    copulaAnalysis: {
      copulaType:      copulaResult.copulaType,
      copulaParameter: copulaResult.copulaParameter,
      probBothScore:   copulaResult.probBothScore,
      prob00:          copulaResult.prob00,
      upperTailDep:    copulaResult.upperTailDependence,
      lowerTailDep:    copulaResult.lowerTailDependence,
    },
    marketIntelligence: marketIntelResult ? {
      impliedHomeWin:     marketIntelResult.impliedHomeWin,
      impliedDraw:        marketIntelResult.impliedDraw,
      impliedAwayWin:     marketIntelResult.impliedAwayWin,
      totalMargin:        marketIntelResult.totalMargin,
      steamMoveDetected:  marketIntelResult.steamMoveDetected,
      steamDirection:     marketIntelResult.steamDirection,
      clvHome:            marketIntelResult.clvHome,
      clvAway:            marketIntelResult.clvAway,
      clvEdge:            marketIntelResult.clvEdge,
      marketEfficiency:   marketIntelResult.marketEfficiency,
      valueBets:          marketIntelResult.valueBets.map((v) => ({
        market: v.market, modelProb: v.modelProb, impliedOdd: v.impliedOdd, edge: v.edge,
      })),
    } : undefined,
    liveContextAnalysis: liveContextResult ? {
      remainingLambdaHome: liveContextResult.remainingLambdaHome,
      remainingLambdaAway: liveContextResult.remainingLambdaAway,
      liveHomeWinProb:     liveContextResult.liveHomeWinProb,
      liveDrawProb:        liveContextResult.liveDrawProb,
      liveAwayWinProb:     liveContextResult.liveAwayWinProb,
      estimatedInjuryTime: liveContextResult.estimatedInjuryTime,
      redCardLambdaHome:   liveContextResult.redCardLambdaHome,
      redCardLambdaAway:   liveContextResult.redCardLambdaAway,
    } : undefined,
    weibullAnalysis: {
      homeDispersion:    weibullResult.homeDispersion,
      awayDispersion:    weibullResult.awayDispersion,
      weibullRhoHome:    weibullResult.weibullRhoHome,
      weibullRhoAway:    weibullResult.weibullRhoAway,
      comPoissonNuHome:  weibullResult.comPoissonNuHome,
      comPoissonNuAway:  weibullResult.comPoissonNuAway,
    },
    contextualFactors: {
      dynamicHomeAdvantage:         contextualResult.dynamicHomeAdvantage,
      homeMotivationMult:           contextualResult.homeMotivationMult,
      awayMotivationMult:           contextualResult.awayMotivationMult,
      seasonStageMultiplier:        contextualResult.seasonStageMultiplier,
      motivationContext:            contextualResult.motivationContext,
      crowdEffect:                  contextualResult.crowdEffect,
      h2hMostCommonScores:          contextualResult.h2hMostCommonScores,
      h2hScorelineRecurrenceFactor: contextualResult.h2hScorelineRecurrenceFactor,
    },
    metaEnsemble: {
      modelDiversity:      metaEnsembleResult.modelDiversity,
      ensembleEntropy:     metaEnsembleResult.ensembleEntropy,
      calibrationShift:    metaEnsembleResult.calibrationShift,
      topScoresAgreement:  metaEnsembleResult.topScores.slice(0, 5).map((s) => ({
        score: `${s.home + liveOffsetHome}-${s.away + liveOffsetAway}`,
        agreementScore: s.agreementScore,
        rank: s.rank,
      })),
      updatedModelWeights: metaEnsembleResult.updatedWeights,
    },
    pressingAnalysis: {
      homePressIndex:       pressingResult.homePressIndex,
      awayPressIndex:       pressingResult.awayPressIndex,
      possessionDominance:  pressingResult.possessionDominance,
      matchupType:          pressingResult.matchupType,
      chaosIndex:           pressingResult.chaosIndex,
      varianceInflation:    pressingResult.varianceInflation,
      expectedCornersHome:  pressingResult.expectedCornersHome,
      expectedCornersAway:  pressingResult.expectedCornersAway,
      tacticalNotes:        pressingResult.tacticalNotes,
    },
    scorelinePatterns: {
      homeWinProb:          scorelineResult.homeWinProb,
      drawProb:             scorelineResult.drawProb,
      awayWinProb:          scorelineResult.awayWinProb,
      bttsProb:             scorelineResult.bttsProb,
      cleanSheetProbHome:   scorelineResult.cleanSheetProbHome,
      cleanSheetProbAway:   scorelineResult.cleanSheetProbAway,
      lateGoalBias:         scorelineResult.lateGoalBias,
      historicalTopScores:  scorelineResult.historicalTopScores,
    },
  };
}

function alphaFromWf(wf: { goalVariance: number; rawAvgFor: number }): number {
  if (wf.goalVariance <= 0 || wf.rawAvgFor <= 0.01) return 0.18;
  return Math.max(0.05, Math.min(2, (wf.goalVariance - wf.rawAvgFor) / Math.max(0.01, wf.rawAvgFor ** 2)));
}
function thetaFromWf(wf: { goalVariance: number; rawAvgFor: number }): number {
  if (wf.goalVariance <= 0 || wf.rawAvgFor <= 0.01) return 1.0;
  return Math.max(0.3, Math.min(2.5, wf.goalVariance / wf.rawAvgFor));
}
