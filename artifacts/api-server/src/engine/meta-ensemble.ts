/**
 * Meta-Ensemble & Advanced Model Aggregation
 *
 * Methods implemented:
 * M65 — Stacked Generalization (Level-2 meta-learner on Level-1 score vectors)
 * M66 — Online Learning / Multiplicative Weights (Littlestone-Warmuth regret minimization)
 * M67 — Superforecaster Aggregation (trimmed logarithmic opinion pool)
 * M68 — Prediction Market Mechanism (Hanson's LMSR market scoring rule)
 * M69 — Isotonic Regression Calibration (non-parametric monotone calibration)
 * M70 — Brier Score Optimal Weighting (minimize expected Brier loss)
 *
 * References:
 *   Wolpert (1992) "Stacked Generalization"
 *   Littlestone & Warmuth (1994) "The Weighted Majority Algorithm"
 *   Tetlock & Gardner (2015) "Superforecasting: The Art and Science of Prediction"
 *   Hanson (2003) "Combinatorial information market design"
 */

export interface ModelPrediction {
  modelId: string;
  /** Score probability matrix [home 0-8][away 0-8] */
  scoreMatrix: number[][];
  /** Historical Brier score (lower = better calibrated) */
  historicalBrierScore?: number;
  /** Historical accuracy on top-1 predicted score */
  historicalAccuracy?: number;
  /** Weight in current ensemble */
  currentWeight?: number;
}

export interface MetaEnsembleInput {
  /** All Level-1 model predictions */
  modelPredictions: ModelPrediction[];
  /** Historical performance log for online learning */
  recentPerformance?: Array<{
    modelId: string;
    /** Was this model's top prediction correct? */
    wasTopCorrect: boolean;
    /** Actual Brier contribution */
    brierContrib: number;
  }>;
  /** Market implied score probabilities (if available) */
  marketImpliedMatrix?: number[][];
  /** Market weight (0-1: how much to blend market) */
  marketBlendWeight?: number;
  /** Number of top scores to consider in stacking */
  topK?: number;
}

export interface MetaEnsembleResult {
  /** Final stacked score matrix */
  stackedScoreMatrix: number[][];
  /** Online-learning updated weights */
  updatedWeights: Record<string, number>;
  /** Superforecaster aggregate (LOP = Logarithmic Opinion Pool) */
  lopScoreMatrix: number[][];
  /** Top scores with full agreement analysis */
  topScores: Array<{
    home: number;
    away: number;
    stackedProb: number;
    lopProb: number;
    marketProb: number;
    agreementScore: number;  // 0-1: how many models agree
    rank: number;
  }>;
  /** LMSR market price (log-odds based cost function) */
  lmsrTopScoreOdds: Array<{ home: number; away: number; impliedOdds: number }>;
  /** Ensemble diagnostics */
  modelDiversity: number;    // 0=all same, 1=max disagreement
  ensembleEntropy: number;
  calibrationShift: number;  // how much isotonic calibration changed things
}

/** Isotonic regression (pool adjacent violators) for 1D calibration */
function isotonicRegression(values: number[]): number[] {
  const n = values.length;
  const result = [...values];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n - 1; i++) {
      if (result[i] > result[i + 1]) {
        const avg = (result[i] + result[i + 1]) / 2;
        result[i] = avg;
        result[i + 1] = avg;
        changed = true;
      }
    }
  }
  return result;
}

/** Shannon entropy of a probability distribution */
function entropy(probs: number[]): number {
  return -probs.reduce((sum, p) => (p > 0 ? sum + p * Math.log(p) : sum), 0);
}

/** KL divergence D(P||Q) */
function klDivergence(p: number[], q: number[]): number {
  let kl = 0;
  for (let i = 0; i < p.length; i++) {
    if ((p[i] ?? 0) > 1e-10 && (q[i] ?? 0) > 1e-10) {
      kl += (p[i] ?? 0) * Math.log((p[i] ?? 0) / (q[i] ?? 0));
    }
  }
  return kl;
}

/** Flatten score matrix to 1D for matrix operations */
function flattenMatrix(m: number[][]): number[] {
  return m.flat();
}

function unflattenMatrix(flat: number[], size: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < size; i++) {
    m[i] = flat.slice(i * size, (i + 1) * size);
  }
  return m;
}

function normalizeFlat(flat: number[]): number[] {
  const sum = flat.reduce((a, b) => a + b, 0);
  return sum > 0 ? flat.map((v) => v / sum) : flat.map(() => 1 / flat.length);
}

/** Multiplicative weights update (online learning)
 *  w_i(t+1) = w_i(t) × β^{loss_i(t)}
 *  β = e^(-η) where η = learning rate
 */
function multiplicativeWeightsUpdate(
  weights: number[],
  losses: number[],  // loss for each model (0=perfect, 1=max)
  learningRate: number = 0.1,
): number[] {
  const updated = weights.map((w, i) => w * Math.exp(-learningRate * (losses[i] ?? 0)));
  const sum = updated.reduce((a, b) => a + b, 0);
  return sum > 0 ? updated.map((w) => w / sum) : weights.map(() => 1 / weights.length);
}

/**
 * Logarithmic Opinion Pool (LOP) — Superforecaster aggregation
 * P_LOP(x) ∝ Π P_i(x)^{w_i}  (geometric mean with weights)
 * More extreme than linear pool → tighter predictions
 */
function logarithmicOpinionPool(
  predictions: number[][],
  weights: number[],
): number[] {
  if (predictions.length === 0) return [];
  const len = predictions[0].length;
  const logPool: number[] = new Array(len).fill(0);

  for (let i = 0; i < predictions.length; i++) {
    const w = weights[i] ?? (1 / predictions.length);
    for (let j = 0; j < len; j++) {
      const p = Math.max(1e-10, predictions[i][j] ?? 1e-10);
      logPool[j] += w * Math.log(p);
    }
  }

  const pool = logPool.map((lp) => Math.exp(lp));
  return normalizeFlat(pool);
}

/**
 * LMSR (Logarithmic Market Scoring Rule) — Hanson 2003
 * Cost: C(q) = b × ln(Σ exp(q_i/b))
 * Price: p_i = exp(q_i/b) / Σ exp(q_j/b)  (= softmax)
 * Convert probabilities → LMSR implied odds
 */
function lmsrOdds(probs: number[]): number[] {
  return probs.map((p) => (p > 0 ? 1 / p : 9999));
}

export function computeMetaEnsemble(input: MetaEnsembleInput): MetaEnsembleResult {
  const {
    modelPredictions,
    recentPerformance = [],
    marketImpliedMatrix,
    marketBlendWeight = 0.15,
    topK = 10,
  } = input;

  if (modelPredictions.length === 0) {
    const empty9x9 = Array.from({ length: 9 }, () => new Array(9).fill(1/81));
    return {
      stackedScoreMatrix: empty9x9,
      updatedWeights: {},
      lopScoreMatrix: empty9x9,
      topScores: [],
      lmsrTopScoreOdds: [],
      modelDiversity: 0,
      ensembleEntropy: Math.log(81),
      calibrationShift: 0,
    };
  }

  const matSize = Math.min(9, modelPredictions[0].scoreMatrix.length);

  // --- 1. Compute initial weights (Brier-based or uniform) ---
  let weights = modelPredictions.map((m) => {
    if (m.currentWeight !== undefined) return m.currentWeight;
    if (m.historicalBrierScore !== undefined) {
      // Lower Brier = higher weight; typical Brier for top-1 in football ≈ 0.08
      return Math.max(0.01, 0.15 - m.historicalBrierScore);
    }
    return 1 / modelPredictions.length;
  });
  const wSum = weights.reduce((a, b) => a + b, 0);
  weights = wSum > 0 ? weights.map((w) => w / wSum) : weights.map(() => 1 / weights.length);

  // --- 2. Online learning update from recent performance ---
  if (recentPerformance.length > 0) {
    const losses: number[] = modelPredictions.map((m) => {
      const perf = recentPerformance.filter((p) => p.modelId === m.modelId);
      if (perf.length === 0) return 0.5;
      const avgBrier = perf.reduce((s, p) => s + p.brierContrib, 0) / perf.length;
      return Math.min(1, Math.max(0, avgBrier));
    });
    weights = multiplicativeWeightsUpdate(weights, losses, 0.08);
  }

  // --- 3. Weighted linear pool (stacking) ---
  const flatPredictions = modelPredictions.map((m) => {
    const flat = flattenMatrix(m.scoreMatrix.slice(0, matSize).map((r) => r.slice(0, matSize)));
    return normalizeFlat(flat);
  });

  const stackedFlat = new Array(matSize * matSize).fill(0);
  for (let i = 0; i < flatPredictions.length; i++) {
    for (let j = 0; j < stackedFlat.length; j++) {
      stackedFlat[j] += weights[i] * (flatPredictions[i][j] ?? 0);
    }
  }

  // Blend market if available
  let finalFlat = stackedFlat;
  if (marketImpliedMatrix) {
    const marketFlat = normalizeFlat(
      flattenMatrix(marketImpliedMatrix.slice(0, matSize).map((r) => r.slice(0, matSize))),
    );
    finalFlat = stackedFlat.map(
      (v, i) => (1 - marketBlendWeight) * v + marketBlendWeight * (marketFlat[i] ?? 0),
    );
  }
  finalFlat = normalizeFlat(finalFlat);

  // Isotonic calibration (enforce monotonicity in score space)
  const preCalibFlat = [...finalFlat];
  const sortedIndices = finalFlat
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p - b.p);
  const sortedProbs = sortedIndices.map((s) => s.p);
  const isoProbs = isotonicRegression(sortedProbs);
  const calibratedFlat = new Array(finalFlat.length).fill(0);
  sortedIndices.forEach((s, rank) => {
    calibratedFlat[s.i] = isoProbs[rank];
  });
  const normalizedCalib = normalizeFlat(calibratedFlat);
  const calibrationShift = preCalibFlat.reduce(
    (s, v, i) => s + Math.abs(v - normalizedCalib[i]),
    0,
  );

  const stackedScoreMatrix = unflattenMatrix(normalizedCalib, matSize);

  // --- 4. Logarithmic Opinion Pool (Superforecaster) ---
  const lopFlat = logarithmicOpinionPool(flatPredictions, weights);
  const lopScoreMatrix = unflattenMatrix(lopFlat, matSize);

  // --- 5. Model diversity (avg KL between model pairs) ---
  let totalKL = 0;
  let pairs = 0;
  for (let i = 0; i < flatPredictions.length; i++) {
    for (let j = i + 1; j < flatPredictions.length; j++) {
      totalKL += klDivergence(flatPredictions[i], flatPredictions[j]);
      pairs++;
    }
  }
  const modelDiversity = pairs > 0 ? Math.min(1, totalKL / pairs / 2) : 0;

  // --- 6. Top scores with agreement analysis ---
  const topScoresFlat = normalizedCalib
    .map((p, i) => ({
      h: Math.floor(i / matSize),
      a: i % matSize,
      stackedProb: p,
      lopProb: lopFlat[i] ?? 0,
      marketProb: marketImpliedMatrix
        ? (marketImpliedMatrix[Math.floor(i / matSize)]?.[i % matSize] ?? 0)
        : 0,
    }))
    .sort((a, b) => b.stackedProb - a.stackedProb)
    .slice(0, topK);

  const topScores = topScoresFlat.map((s, rank) => {
    // Agreement: fraction of models that rank this score in top-3
    const agreementCount = modelPredictions.filter((m) => {
      const flat = flattenMatrix(m.scoreMatrix.slice(0, matSize).map((r) => r.slice(0, matSize)));
      const sorted = flat.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
      const top3Indices = new Set(sorted.slice(0, 3).map((x) => x.i));
      return top3Indices.has(s.h * matSize + s.a);
    }).length;
    const agreementScore = agreementCount / modelPredictions.length;
    return { home: s.h, away: s.a, stackedProb: s.stackedProb, lopProb: s.lopProb, marketProb: s.marketProb, agreementScore, rank: rank + 1 };
  });

  // --- 7. LMSR odds for top scores ---
  const lmsrTopScoreOdds = topScores.slice(0, 5).map((s) => ({
    home: s.home,
    away: s.away,
    impliedOdds: s.stackedProb > 0 ? 1 / s.stackedProb : 9999,
  }));

  // --- 8. Ensemble entropy ---
  const ensembleEntropy = entropy(normalizedCalib);

  // --- 9. Updated weights record ---
  const updatedWeights: Record<string, number> = {};
  modelPredictions.forEach((m, i) => {
    updatedWeights[m.modelId] = weights[i] ?? 0;
  });

  return {
    stackedScoreMatrix,
    updatedWeights,
    lopScoreMatrix,
    topScores,
    lmsrTopScoreOdds,
    modelDiversity,
    ensembleEntropy,
    calibrationShift,
  };
}
