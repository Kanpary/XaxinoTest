/**
 * Bayesian Model Averaging (BMA) + Stacking + Dynamic Weight Recalibration.
 *
 * BAYESIAN MODEL AVERAGING (Hoeting et al. 1999):
 * Combines model predictions weighted by their marginal likelihood:
 *   P(outcome | data) = Σ_k w_k * P(outcome | model_k, data)
 * Weights proportional to P(data | model_k) * P(model_k).
 *
 * Implementation: use Brier Score as a proxy for model evidence.
 * Lower Brier Score → higher weight.
 * w_k ∝ exp(-BS_k * τ)  where τ is a temperature parameter.
 *
 * Since we often don't have per-model Brier scores stored, we derive
 * approximate weights from the ensemble convergence and model agreement
 * using the Total Variation Distance (TVD) between model distributions.
 *
 * STACKING (Wolpert 1992):
 * Learn a linear combination of model outputs that minimizes a loss function.
 * Equivalent to a weighted average where weights are learned from data.
 * Here we implement a "poor man's stacking" that uses TVD agreement as
 * a proxy for stacking weights.
 *
 * CLOSING LINE VALUE (CLV):
 * The gold standard for evaluating betting value. CLV measures whether
 * the model's probability exceeds the closing (final) market probability.
 * CLV > 0 consistently indicates a profitable model.
 *   CLV = (model_prob - closing_market_implied_prob) / closing_market_implied_prob
 *
 * DYNAMIC MODEL WEIGHT RECALIBRATION:
 * After each resolved prediction, update model weights based on:
 *   - Hit: increase model weight for models that predicted the correct score
 *   - Miss: decrease weight proportionally
 * Implemented as exponential moving average of model accuracy.
 *
 * References:
 *   Hoeting, Madigan, Raftery & Volinsky (1999) "Bayesian Model Averaging:
 *     A Tutorial". Statistical Science 14(4):382-417.
 *   Wolpert (1992) "Stacked Generalization". Neural Networks 5(2):241-259.
 *   Pinnuck (2004) "A Re-examination of the Ability of an Analyst to Forecast
 *     Stock Returns". Journal of Business Finance & Accounting.
 */

import type { ModelOutput } from "./ensemble";
import { topNScores } from "./score-utils";

export interface BMAResult {
  /** BMA-weighted model weights (normalized) */
  weights: Record<string, number>;
  /** BMA combined score matrix */
  combinedMatrix: number[][];
  /** Temperature parameter used */
  temperature: number;
  /** Model agreement score (1 = perfect agreement) */
  agreementScore: number;
}

export interface ClosingLineValue {
  /** Model probability for the primary score */
  modelProb: number;
  /** Closing market implied probability (from decimal odds, vig removed) */
  closingImpliedProb: number | null;
  /** CLV percentage */
  clv: number | null;
  /** Whether there is positive CLV */
  hasPositiveCLV: boolean;
  /** CLV label */
  label: string;
}

export interface DynamicWeightUpdate {
  /** Updated weight for a model after resolving a prediction */
  updatedWeight: number;
  /** Whether the model predicted the correct score */
  wasCorrect: boolean;
}

// ── BMA Weights from TVD ──────────────────────────────────────────────────────

/**
 * Total Variation Distance between two score matrices.
 * TVD ∈ [0, 1]: 0 = identical, 1 = completely different.
 */
function tvdBetweenMatrices(a: number[][], b: number[][]): number {
  let tvd = 0;
  const rows = Math.min(a.length, b.length);
  for (let i = 0; i < rows; i++) {
    const cols = Math.min((a[i] ?? []).length, (b[i] ?? []).length);
    for (let j = 0; j < cols; j++) {
      tvd += Math.abs((a[i]?.[j] ?? 0) - (b[i]?.[j] ?? 0));
    }
  }
  return tvd / 2; // TVD = half the L1 distance
}

/**
 * Compute BMA weights using model agreement (TVD-based) as a proxy for evidence.
 * Models that agree with the majority get higher weight.
 *
 * @param models     Array of model outputs from the ensemble
 * @param temperature Softmax temperature (lower = more concentrated weights)
 */
export function computeBMAWeights(
  models: ModelOutput[],
  temperature: number = 0.5,
): BMAResult {
  if (models.length === 0) {
    return {
      weights: {},
      combinedMatrix: [],
      temperature,
      agreementScore: 0,
    };
  }

  const n = models.length;

  // For each model, compute its average agreement with all other models
  // Higher agreement → more likely to be the "true" model → higher BMA weight
  const agreementScores: number[] = [];
  let totalAgreement = 0;

  for (let i = 0; i < n; i++) {
    let sumAgreement = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const tvd = tvdBetweenMatrices(models[i]!.matrix, models[j]!.matrix);
      sumAgreement += (1 - tvd); // agreement = 1 - TVD
    }
    const avgAgreement = n > 1 ? sumAgreement / (n - 1) : 1.0;
    agreementScores.push(avgAgreement);
    totalAgreement += avgAgreement;
  }

  // BMA weights: softmax of agreement scores
  // w_i = exp(agreement_i / temperature) / Σ exp(agreement_j / temperature)
  const maxAgreement = Math.max(...agreementScores);
  const expScores = agreementScores.map((s) => Math.exp((s - maxAgreement) / temperature));
  const expSum = expScores.reduce((a, b) => a + b, 0) || 1;
  const normalizedWeights = expScores.map((e) => e / expSum);

  // Blend with existing model weights (50% BMA, 50% ensemble weights)
  const weightRecord: Record<string, number> = {};
  let blendedSum = 0;
  for (let i = 0; i < n; i++) {
    const blended = normalizedWeights[i]! * 0.5 + models[i]!.weight * 0.5;
    weightRecord[models[i]!.name] = blended;
    blendedSum += blended;
  }
  // Normalize
  for (const key of Object.keys(weightRecord)) {
    weightRecord[key] = (weightRecord[key]! / blendedSum);
  }

  // Build BMA combined matrix
  const max = models[0]!.matrix.length - 1;
  const combinedMatrix: number[][] = Array.from({ length: max + 1 }, (_, h) =>
    Array.from({ length: max + 1 }, (_, a) => {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += (weightRecord[models[i]!.name] ?? 0) * (models[i]!.matrix[h]?.[a] ?? 0);
      }
      return sum;
    }),
  );

  const overallAgreement = n > 1 ? totalAgreement / n : 1.0;

  return {
    weights: weightRecord,
    combinedMatrix,
    temperature,
    agreementScore: overallAgreement,
  };
}

// ── Closing Line Value ────────────────────────────────────────────────────────

export function computeCLV(
  modelProb: number,
  closingOdd: number | null,
): ClosingLineValue {
  if (!closingOdd || closingOdd <= 1) {
    return {
      modelProb,
      closingImpliedProb: null,
      clv: null,
      hasPositiveCLV: false,
      label: "sem odds de fechamento disponíveis",
    };
  }

  // Remove vig (single-sided vig estimate: ~8% overround)
  const rawImplied = 1 / closingOdd;
  const closingImpliedProb = rawImplied / 1.08; // remove estimated vig

  const clv = closingImpliedProb > 0
    ? ((modelProb - closingImpliedProb) / closingImpliedProb) * 100
    : null;

  const hasPositiveCLV = (clv ?? 0) > 0;

  const label =
    clv === null ? "sem dados" :
    clv >= 10 ? "CLV muito forte (+≥10%) — modelo está na frente do mercado" :
    clv >= 5 ? "CLV forte (+5-10%) — boa vantagem informacional" :
    clv >= 2 ? "CLV moderado (+2-5%) — leve vantagem" :
    clv >= 0 ? "CLV neutro (0-2%) — próximo do mercado" :
    clv >= -5 ? "CLV negativo — mercado mais eficiente aqui" :
    "CLV muito negativo — rever modelo para este tipo de jogo";

  return { modelProb, closingImpliedProb, clv, hasPositiveCLV, label };
}

// ── Dynamic Weight Update (EMA-based) ────────────────────────────────────────

/**
 * Update a model's weight after a resolved prediction using EMA.
 * Hit rate improves weight; miss rate degrades it.
 *
 * @param currentWeight  Current model weight (0–1)
 * @param wasCorrect     Whether the model predicted the exact score
 * @param alpha          EMA decay factor (0.1 = slow learning, 0.3 = fast)
 * @param baseWeight     Prior weight to revert toward (prevents collapse)
 */
export function updateModelWeight(
  currentWeight: number,
  wasCorrect: boolean,
  alpha: number = 0.15,
  baseWeight: number = 0.1,
): DynamicWeightUpdate {
  const signal = wasCorrect ? 1.0 : 0.0;
  const updatedWeight = Math.max(
    baseWeight * 0.5,
    Math.min(1.0,
      currentWeight * (1 - alpha) + signal * alpha,
    ),
  );

  return { updatedWeight, wasCorrect };
}

// ── Score Cluster Analysis ────────────────────────────────────────────────────

export interface ScoreClusterResult {
  /** Whether top-3 scores cluster in a tight probability range */
  isTightCluster: boolean;
  /** Probability spread between rank-1 and rank-3 */
  topSpread: number;
  /** Dominant score zone label */
  dominantZone: string;
  /** Risk assessment */
  riskLabel: string;
}

export function analyzeScoreClusters(
  topN: Array<{ home: number; away: number; prob: number }>,
): ScoreClusterResult {
  if (topN.length < 3) {
    return {
      isTightCluster: false,
      topSpread: 1,
      dominantZone: "indeterminado",
      riskLabel: "dados insuficientes",
    };
  }

  const top3 = topN.slice(0, 3);
  const topSpread = (top3[0]?.prob ?? 0) - (top3[2]?.prob ?? 0);
  const isTightCluster = topSpread < 0.03; // top-3 within 3% of each other

  // Determine dominant zone by total goals
  const avgTotal = top3.reduce((s, c) => s + c.home + c.away, 0) / 3;
  const dominantZone =
    avgTotal < 1.5 ? "zona defensiva (0-1 gols)" :
    avgTotal < 2.5 ? "zona equilibrada (1-2 gols)" :
    avgTotal < 3.5 ? "zona produtiva (2-3 gols)" :
    "zona aberta (3+ gols)";

  const riskLabel = isTightCluster
    ? "cluster apertado — múltiplos placares igualmente prováveis"
    : topSpread > 0.06
      ? "dominância clara do placar principal — cobertura eficiente"
      : "distribuição moderada — proteção em 2 placares recomendada";

  return { isTightCluster, topSpread, dominantZone, riskLabel };
}

// Re-export topNScores for convenience
export { topNScores };
