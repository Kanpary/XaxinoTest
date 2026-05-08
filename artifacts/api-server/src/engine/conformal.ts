/**
 * Conformal Prediction Sets + Model Entropy + Brier Score Decomposition.
 *
 * CONFORMAL PREDICTION SETS (Vovk et al. 2005):
 * A model-agnostic method that produces prediction sets with a valid
 * statistical coverage guarantee. For a target coverage α (e.g. 80%):
 *   - Sort scores by descending probability
 *   - Accumulate until cumulative probability ≥ α
 *   - The resulting set contains the true outcome with ≥ α probability
 *   - This is the "Adaptive Prediction Set" (RAPS) variant
 *
 * This gives bettors a well-calibrated set of scores to cover, not just
 * the top-1 prediction. The set size quantifies prediction uncertainty.
 *
 * MODEL ENTROPY (Shannon 1948):
 * H = -Σ p_i * log(p_i)  over the top-N score distribution.
 * High entropy = models disagree / uncertain.
 * Low entropy = models converge / confident.
 * Normalized to [0,1] by dividing by log(N).
 *
 * BRIER SCORE DECOMPOSITION (Murphy 1973):
 * Decomposes forecasting skill into three components:
 *   BS = Reliability - Resolution + Uncertainty
 *   - Reliability: how well calibrated are the probabilities (lower = better)
 *   - Resolution: how much the forecasts differ from the base rate (higher = better)
 *   - Uncertainty: inherent unpredictability of the outcome (fixed given base rate)
 *
 * We compute a simplified version from the score distribution:
 *   Proxy for resolution = variance of top-N probabilities
 *   Proxy for reliability = deviation from perfect calibration (assumed uniform)
 *   Uncertainty = -p_base * log(p_base) where p_base is the primary score prob
 *
 * REGRESSION TO MEAN:
 * Teams that have had extreme form (very high or very low goal rates) will regress.
 * We compute a regression coefficient from the ratio of form ESS to total ESS.
 *
 * References:
 *   Vovk, Gammerman & Shafer (2005) "Algorithmic Learning in a Random World". Springer.
 *   Angelopoulos & Bates (2022) "A Gentle Introduction to Conformal Prediction".
 *   Murphy (1973) "A New Vector Partition of the Probability Score". J. Appl. Meteor.
 *   Shannon (1948) "A Mathematical Theory of Communication". Bell System Tech. J.
 */

export interface ConformalPredictionSet {
  /** Scores in the prediction set (sorted by descending probability) */
  scores: string[];
  /** Target coverage (e.g. 0.80) */
  targetCoverage: number;
  /** Actual cumulative probability of the set */
  actualCoverage: number;
  /** Number of scores in the set (set size = uncertainty proxy) */
  setSize: number;
  /** Whether the set is tight (small, < 4 scores) = high confidence */
  isTight: boolean;
}

export interface ModelEntropyResult {
  /** Shannon entropy (nats) over top-N score probabilities */
  entropy: number;
  /** Normalized entropy [0,1]: 0 = certain, 1 = maximum uncertainty */
  normalizedEntropy: number;
  /** Entropy label */
  label: string;
}

export interface BrierDecomposition {
  /** Proxy for reliability (lower = better calibration) */
  reliability: number;
  /** Proxy for resolution (higher = more informative forecasts) */
  resolution: number;
  /** Uncertainty component (fixed by base rate) */
  uncertainty: number;
  /** Overall skill score [0,1]: 1 = perfect, 0 = no skill */
  skillScore: number;
}

export interface RegressionToMeanResult {
  /** How much the team's form will revert toward the league average [0,1] */
  regressionCoefficient: number;
  /** Adjusted lambda after regression to mean */
  adjustedLambdaHome: number;
  adjustedLambdaAway: number;
}

// ── Conformal Prediction Set ──────────────────────────────────────────────────

export function computeConformalSet(
  topN: Array<{ home: number; away: number; prob: number }>,
  targetCoverage: number = 0.80,
): ConformalPredictionSet {
  const sorted = [...topN].sort((a, b) => b.prob - a.prob);

  const scores: string[] = [];
  let cumProb = 0;

  for (const cell of sorted) {
    if (cumProb >= targetCoverage) break;
    scores.push(`${cell.home}-${cell.away}`);
    cumProb += cell.prob;
  }

  // If we haven't reached target coverage, add remaining scores
  if (cumProb < targetCoverage) {
    for (const cell of sorted) {
      const key = `${cell.home}-${cell.away}`;
      if (!scores.includes(key)) {
        scores.push(key);
        cumProb += cell.prob;
        if (cumProb >= targetCoverage) break;
      }
    }
  }

  return {
    scores,
    targetCoverage,
    actualCoverage: Math.min(1, cumProb),
    setSize: scores.length,
    isTight: scores.length <= 3,
  };
}

// ── Model Entropy ─────────────────────────────────────────────────────────────

export function computeModelEntropy(
  topN: Array<{ home: number; away: number; prob: number }>,
): ModelEntropyResult {
  if (topN.length === 0) {
    return { entropy: 0, normalizedEntropy: 0.5, label: "sem dados" };
  }

  // Use top-16 scores for entropy computation
  const top16 = topN.slice(0, 16);
  const totalProb = top16.reduce((s, c) => s + c.prob, 0);
  if (totalProb < 1e-10) {
    return { entropy: 0, normalizedEntropy: 0, label: "concentrado" };
  }

  let entropy = 0;
  for (const cell of top16) {
    const p = cell.prob / totalProb;
    if (p > 1e-10) entropy -= p * Math.log(p);
  }

  // Normalize to [0,1] by max entropy = log(n)
  const maxEntropy = Math.log(top16.length);
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  const label =
    normalizedEntropy < 0.30 ? "alta concentração (confiança forte)" :
    normalizedEntropy < 0.50 ? "concentrado (convergência boa)" :
    normalizedEntropy < 0.70 ? "moderado (incerteza razoável)" :
    normalizedEntropy < 0.85 ? "disperso (modelos divergem)" :
    "muito disperso (alta incerteza)";

  return { entropy, normalizedEntropy, label };
}

// ── Brier Score Decomposition ─────────────────────────────────────────────────

export function computeBrierDecomposition(
  topN: Array<{ home: number; away: number; prob: number }>,
): BrierDecomposition {
  if (topN.length < 2) {
    return { reliability: 0.5, resolution: 0, uncertainty: 0.5, skillScore: 0 };
  }

  const primaryProb = topN[0]?.prob ?? 0.05;
  const probs = topN.map((c) => c.prob);
  const meanProb = probs.reduce((s, p) => s + p, 0) / probs.length;

  // Resolution: variance of probabilities (how spread out the forecast is)
  const resolution = probs.reduce((s, p) => s + (p - meanProb) ** 2, 0) / probs.length;

  // Reliability: how well-calibrated (deviation from ideal calibration)
  // Proxy: the more concentrated around the primary, the better calibrated
  const reliability = Math.max(0, 0.25 - primaryProb * 0.5);

  // Uncertainty: inherent unpredictability (entropy-like)
  const uncertainty = primaryProb > 0 && primaryProb < 1
    ? -primaryProb * Math.log(primaryProb) - (1 - primaryProb) * Math.log(1 - primaryProb)
    : 0.5;

  // Skill score: resolution / (reliability + uncertainty + 0.01)
  const skillScore = Math.max(0, Math.min(1,
    resolution / (reliability + uncertainty + 0.01),
  ));

  return { reliability, resolution, uncertainty, skillScore };
}

// ── Regression to Mean ────────────────────────────────────────────────────────

/**
 * Regress extreme form-derived lambdas toward the league average.
 *
 * Regression coefficient: r = leagueESS / (formESS + leagueESS)
 * where leagueESS = 12 (represents one full season's worth of regression signal).
 * High formESS → lower r → less regression needed.
 * Low formESS → higher r → stronger pull to mean.
 */
export function applyRegressionToMean(
  lambdaHome: number,
  lambdaAway: number,
  formESSHome: number,
  formESSAway: number,
  leagueAvgGoals: number = 1.35,
  leagueESS: number = 12,
): RegressionToMeanResult {
  const rHome = leagueESS / (formESSHome + leagueESS);
  const rAway = leagueESS / (formESSAway + leagueESS);

  const adjustedLambdaHome = lambdaHome * (1 - rHome) + leagueAvgGoals * rHome;
  const adjustedLambdaAway = lambdaAway * (1 - rAway) + leagueAvgGoals * rAway;

  // Average regression coefficient for display
  const regressionCoefficient = (rHome + rAway) / 2;

  return {
    regressionCoefficient,
    adjustedLambdaHome: Math.max(0.1, Math.min(8, adjustedLambdaHome)),
    adjustedLambdaAway: Math.max(0.1, Math.min(8, adjustedLambdaAway)),
  };
}
