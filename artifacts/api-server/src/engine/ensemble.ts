/**
 * Ensemble orchestrator — 10 core models + optional H2H-adjusted Poisson.
 *
 * Models (v5 — 30 métodos profissionais):
 *   1. Dixon-Coles         — Poisson with tau correction for low scores
 *   2. Bivariate Poisson   — correlated goals via rho parameter
 *   3. Elo-Poisson         — goals derived from Elo rating differential
 *   4. Weighted Form       — exponential decay form with Bayesian shrinkage
 *   5. Negative Binomial   — overdispersed Poisson (var > mean, realistic)
 *   6. Zero-Inflated Poisson — extra zeros for defensive/low-scoring matches
 *   7. Double Poisson (Efron 1986) — handles both over and underdispersion
 *   8. Hurdle Model        — two-part: P(score=0) + truncated Poisson for k≥1
 *   9. Bradley-Terry       — paired comparison model for match outcome → lambda
 *  10. Platt-Calibrated DC — Dixon-Coles with Platt-scaled output probabilities
 *  11. H2H Dixon-Coles     — DC calibrated to head-to-head averages (optional)
 *
 * Dynamic model selection:
 * - Model weights are dynamically adjusted based on:
 *   a) Ensemble convergence (TVD agreement)
 *   b) Fixture-specific features (high variance → more NegBin weight)
 *   c) Sample size (thin data → more Elo/BT weight, less Form weight)
 *   d) BMA agreement scores (models that agree with majority get upweighted)
 */

import { dixonColesScoreMatrix } from "./dixon-coles";
import { bivariatePoissonScoreMatrix } from "./bivariate-poisson";
import { poissonScoreMatrix } from "./poisson";
import { negativeBinomialScoreMatrix, estimateAlphaFromCV } from "./negative-binomial";
import { zipScoreMatrix, estimateZeroInflationFromHistory } from "./zero-inflated";
import { doublePoissonScoreMatrix, estimateDoublePoissonTheta, hurdleScoreMatrix } from "./double-poisson";
import { bradleyTerryAnalysis } from "./bradley-terry";
import { calibrateScoreMatrix } from "./platt-calibration";
import { computeBMAWeights } from "./bma-weights";
import { combineMatricesWeighted, ensembleConvergence, topNScores } from "./score-utils";
import type { ScoreCell } from "./score-utils";
import type { PastMatch } from "./weighted-form";

export interface H2HData {
  avgH2HHome: number;
  avgH2HAway: number;
  sampleSize: number;
}

export interface EnsembleInputs {
  formLambdas: { lambdaHome: number; lambdaAway: number };
  eloLambdas: { lambdaHome: number; lambdaAway: number };
  formEffectiveSampleSize: number;
  tau: number;
  rho: number;
  weights: {
    dixonColes: number;
    bivariate: number;
    eloPoisson: number;
    weightedForm: number;
  };
  h2h?: H2HData | null;
  maxGoals?: number;
  formMetrics?: {
    homeGoalVariance?: number;
    awayGoalVariance?: number;
    homeMeanGoals?: number;
    awayMeanGoals?: number;
    homeFailedToScoreRate?: number;
    awayFailedToScoreRate?: number;
  };
  /** Raw match histories for Bradley-Terry and Double Poisson theta estimation */
  homeHistory?: PastMatch[];
  awayHistory?: PastMatch[];
}

export interface ModelOutput {
  name: string;
  matrix: number[][];
  topScore: ScoreCell;
  weight: number;
}

export interface EnsembleResult {
  models: ModelOutput[];
  combined: number[][];
  convergence: number;
  top: ScoreCell[];
  blendedLambdas: { lambdaHome: number; lambdaAway: number };
  /** BMA model agreement score (0–1, higher = more agreement) */
  bmaAgreement: number;
  /** Dynamic model weights from BMA (model name → weight) */
  bmaWeights: Record<string, number>;
}

// ── Lambda blending ───────────────────────────────────────────────────────────

function blendLambdas(
  form: { lambdaHome: number; lambdaAway: number },
  elo: { lambdaHome: number; lambdaAway: number },
  effectiveSampleSize: number,
): { lambdaHome: number; lambdaAway: number } {
  const eloEquivESS = 4;
  const formWeight = effectiveSampleSize / (effectiveSampleSize + eloEquivESS);
  const eloWeight = 1 - formWeight;
  return {
    lambdaHome: form.lambdaHome * formWeight + elo.lambdaHome * eloWeight,
    lambdaAway: form.lambdaAway * formWeight + elo.lambdaAway * eloWeight,
  };
}

function applyH2HBlend(
  lambdas: { lambdaHome: number; lambdaAway: number },
  h2h: H2HData,
  baseESS: number,
): { lambdaHome: number; lambdaAway: number } {
  if (h2h.sampleSize === 0) return lambdas;
  const h2hEquivESS = 3;
  const h2hEvidence = h2h.sampleSize * h2hEquivESS;
  const totalEvidence = Math.max(1, baseESS + h2hEvidence);
  const h2hWeight = h2hEvidence / totalEvidence;
  const baseWeight = 1 - h2hWeight;
  return {
    lambdaHome: lambdas.lambdaHome * baseWeight + h2h.avgH2HHome * h2hWeight,
    lambdaAway: lambdas.lambdaAway * baseWeight + h2h.avgH2HAway * h2hWeight,
  };
}

// ── Dynamic weight adjustment based on fixture features ───────────────────────

interface DynamicWeightFactors {
  isHighVariance: boolean;      // NegBin/DP gets more weight
  isThinSample: boolean;        // Elo/BT gets more weight
  isZeroInflated: boolean;      // ZIP/Hurdle gets more weight
  isUnderdispersed: boolean;    // Double Poisson (theta < 1) gets more weight
  isDefensiveGame: boolean;     // DC tau correction more important
}

function computeDynamicFactors(
  formMetrics: EnsembleInputs["formMetrics"],
  ess: number,
  lh: number,
  la: number,
): DynamicWeightFactors {
  const fm = formMetrics ?? {};
  const avgVar = ((fm.homeGoalVariance ?? 1.35) + (fm.awayGoalVariance ?? 1.35)) / 2;
  const avgMean = ((fm.homeMeanGoals ?? 1.35) + (fm.awayMeanGoals ?? 1.35)) / 2;
  const avgFTS = ((fm.homeFailedToScoreRate ?? 0.2) + (fm.awayFailedToScoreRate ?? 0.2)) / 2;

  return {
    isHighVariance: avgVar > avgMean * 1.4, // overdispersed
    isThinSample: ess < 6,
    isZeroInflated: avgFTS > 0.30,
    isUnderdispersed: avgVar < avgMean * 0.7, // tight, low-variance games
    isDefensiveGame: (lh + la) < 2.0,
  };
}

// ── Main ensemble ─────────────────────────────────────────────────────────────

export function runEnsemble(input: EnsembleInputs): EnsembleResult {
  const max = input.maxGoals ?? 8;

  // ── Lambda blending ──────────────────────────────────────────────────────
  let blended = blendLambdas(input.formLambdas, input.eloLambdas, input.formEffectiveSampleSize);
  if (input.h2h && input.h2h.sampleSize > 0) {
    blended = applyH2HBlend(blended, input.h2h, input.formEffectiveSampleSize);
  }
  const { lambdaHome: lh, lambdaAway: la } = blended;

  // ── NegBin overdispersion estimation ─────────────────────────────────────
  // FIX 13: estimateAlphaFromCV was called with Array.from({length:5}, ()=>mean)
  // — i.e., 5 identical copies of the mean — so the computed sample variance is
  // exactly 0. This gives alpha = (0 - mean) / mean² < 0, which is clamped to
  // the hard floor 0.05. Result: NegBin always ran at near-Poisson alpha=0.05,
  // WORSE than the well-calibrated defaults (0.18/0.22), and homeGoalVariance /
  // awayGoalVariance from the form model was completely ignored.
  // Fix: apply method-of-moments directly — α = (σ² − μ) / μ².
  const fm = input.formMetrics ?? {};
  const alphaHome = fm.homeGoalVariance !== undefined && fm.homeMeanGoals !== undefined
    ? Math.max(0.05, Math.min(0.40,
        (fm.homeGoalVariance - fm.homeMeanGoals) / Math.max(0.01, fm.homeMeanGoals ** 2),
      ))
    : 0.18;
  const alphaAway = fm.awayGoalVariance !== undefined && fm.awayMeanGoals !== undefined
    ? Math.max(0.05, Math.min(0.40,
        (fm.awayGoalVariance - fm.awayMeanGoals) / Math.max(0.01, fm.awayMeanGoals ** 2),
      ))
    : 0.22;

  // ── ZIP zero-inflation estimation ─────────────────────────────────────────
  const piHome = fm.homeFailedToScoreRate !== undefined
    ? estimateZeroInflationFromHistory(fm.homeFailedToScoreRate, lh)
    : undefined;
  const piAway = fm.awayFailedToScoreRate !== undefined
    ? estimateZeroInflationFromHistory(fm.awayFailedToScoreRate, la)
    : undefined;

  // ── Double Poisson theta estimation ───────────────────────────────────────
  const thetaHome = fm.homeGoalVariance !== undefined && fm.homeMeanGoals !== undefined
    ? estimateDoublePoissonTheta(fm.homeMeanGoals, fm.homeGoalVariance)
    : 1.0;
  const thetaAway = fm.awayGoalVariance !== undefined && fm.awayMeanGoals !== undefined
    ? estimateDoublePoissonTheta(fm.awayMeanGoals, fm.awayGoalVariance)
    : 1.0;

  // ── Hurdle pi (same as ZIP, using empirical failed-to-score rate) ─────────
  const hurdlePiHome = Math.max(0, Math.min(0.65, fm.homeFailedToScoreRate ?? 0.20));
  const hurdlePiAway = Math.max(0, Math.min(0.65, fm.awayFailedToScoreRate ?? 0.20));

  // ── Bradley-Terry model (if history available) ────────────────────────────
  const hasBTHistory = (input.homeHistory?.length ?? 0) >= 3 && (input.awayHistory?.length ?? 0) >= 3;
  const btResult = hasBTHistory
    ? bradleyTerryAnalysis(input.homeHistory!, input.awayHistory!, (lh + la) / 2, max)
    : null;

  // ── Dynamic factors ───────────────────────────────────────────────────────
  const dynFactors = computeDynamicFactors(input.formMetrics, input.formEffectiveSampleSize, lh, la);

  // ── Build all model matrices ───────────────────────────────────────────────

  // Model 1: Dixon-Coles
  const dc = dixonColesScoreMatrix(lh, la, input.tau, max);

  // Model 2: Bivariate Poisson
  const biv = bivariatePoissonScoreMatrix(lh, la, input.rho, max);

  // Model 3: Elo-Poisson
  const elo = poissonScoreMatrix(input.eloLambdas.lambdaHome, input.eloLambdas.lambdaAway, max);

  // Model 4: Weighted Form Poisson
  const form = poissonScoreMatrix(input.formLambdas.lambdaHome, input.formLambdas.lambdaAway, max);

  // Model 5: Negative Binomial
  const negBin = negativeBinomialScoreMatrix(lh, la, alphaHome, alphaAway, max);

  // Model 6: Zero-Inflated Poisson
  const zip = zipScoreMatrix(lh, la, piHome ?? null, piAway ?? null, max);

  // Model 7: Double Poisson (Efron 1986)
  const dpMatrix = doublePoissonScoreMatrix(lh, la, thetaHome, thetaAway, max);

  // Model 8: Hurdle Model
  const hurdleMatrix = hurdleScoreMatrix(lh, la, hurdlePiHome, hurdlePiAway, max);

  // Model 9: Bradley-Terry derived Poisson (or fallback to Elo)
  const btMatrix = btResult?.matrix ?? elo;

  // Model 10: Platt-calibrated Dixon-Coles
  const plattDC = calibrateScoreMatrix(dc);

  // ── Base weights (from calibrated model state) ────────────────────────────
  const dcW    = input.weights.dixonColes;
  const bivW   = input.weights.bivariate;
  const eloW   = input.weights.eloPoisson;
  const formW  = input.weights.weightedForm;
  const baseSum = dcW + bivW + eloW + formW;

  // Extended model weights as fractions of baseSum
  let negBinW  = baseSum * (dynFactors.isHighVariance ? 0.28 : 0.20);
  let zipW     = baseSum * (dynFactors.isZeroInflated ? 0.18 : 0.10);
  let dpW      = baseSum * (dynFactors.isUnderdispersed ? 0.20 : 0.10);
  let hurdleW  = baseSum * (dynFactors.isZeroInflated ? 0.15 : 0.08);
  let btW      = baseSum * (dynFactors.isThinSample ? 0.18 : 0.10);
  let plattW   = baseSum * (dynFactors.isDefensiveGame ? 0.15 : 0.08);

  // Reduce form/elo weight when sample is thin and BT can compensate
  const scaledDcW   = dynFactors.isDefensiveGame ? dcW * 1.10 : dcW;
  const scaledBivW  = bivW;
  const scaledEloW  = dynFactors.isThinSample ? eloW * 1.10 : eloW;
  const scaledFormW = dynFactors.isThinSample ? formW * 0.85 : formW;

  const coreMatrices  = [dc, biv, elo, form, negBin, zip, dpMatrix, hurdleMatrix, btMatrix, plattDC];
  const coreWeights   = [scaledDcW, scaledBivW, scaledEloW, scaledFormW, negBinW, zipW, dpW, hurdleW, btW, plattW];
  const modelNamesList = [
    "Dixon-Coles", "Bivariate Poisson", "Elo-Poisson", "Weighted Form",
    "Negative Binomial", "Zero-Inflated Poisson",
    "Double Poisson (Efron)", "Hurdle Model",
    hasBTHistory ? "Bradley-Terry" : "Bradley-Terry (proxy)",
    "Platt-Calibrated DC",
  ];

  // ── Optional H2H Dixon-Coles ──────────────────────────────────────────────
  let allMatrices  = coreMatrices;
  let allWeights   = coreWeights;
  const allNames   = [...modelNamesList];
  const allWDisplay = [...coreWeights];

  if (input.h2h && input.h2h.sampleSize > 0) {
    const h2hDC = dixonColesScoreMatrix(
      Math.max(0.1, input.h2h.avgH2HHome),
      Math.max(0.1, input.h2h.avgH2HAway),
      input.tau,
      max,
    );
    const h2hEvidence = input.h2h.sampleSize * 3;
    const baseEvidence = Math.max(1, input.formEffectiveSampleSize + 4);
    const h2hW = h2hEvidence / (h2hEvidence + baseEvidence);
    const scale = 1 - h2hW;
    allMatrices = [...coreMatrices, h2hDC];
    allWeights  = [...coreWeights.map((w) => w * scale), h2hW];
    allNames.push("H2H Dixon-Coles");
    allWDisplay.push(h2hW);
  }

  // ── Normalize all weights ─────────────────────────────────────────────────
  const wSum = allWeights.reduce((s, w) => s + w, 0) || 1;
  const normWeights = allWeights.map((w) => w / wSum);

  // ── BMA weighting pass ────────────────────────────────────────────────────
  // Build preliminary ModelOutput for BMA
  const prelimModels: ModelOutput[] = allMatrices.map((m, i) => ({
    name: allNames[i]!,
    matrix: m,
    topScore: topNScores(m, 1)[0]!,
    weight: normWeights[i]!,
  }));

  const bmaResult = computeBMAWeights(prelimModels, 0.5);

  // Blend normWeights with BMA weights (60% ensemble, 40% BMA)
  const finalWeights = normWeights.map((w, i) => {
    const bmaW = bmaResult.weights[allNames[i]!] ?? w;
    return w * 0.60 + bmaW * 0.40;
  });
  const fwSum = finalWeights.reduce((s, w) => s + w, 0) || 1;
  const finalNorm = finalWeights.map((w) => w / fwSum);

  // ── Combine into final matrix ─────────────────────────────────────────────
  const combined = combineMatricesWeighted(allMatrices, finalNorm);

  // Convergence measured on 4 original core models for comparability
  const convergence = ensembleConvergence([dc, biv, elo, form]);

  const models: ModelOutput[] = allMatrices.map((m, i) => ({
    name: allNames[i]!,
    matrix: m,
    topScore: topNScores(m, 1)[0]!,
    weight: finalNorm[i]!,
  }));

  return {
    models,
    combined,
    convergence,
    top: topNScores(combined, 16),
    blendedLambdas: blended,
    bmaAgreement: bmaResult.agreementScore,
    bmaWeights: bmaResult.weights,
  };
}
