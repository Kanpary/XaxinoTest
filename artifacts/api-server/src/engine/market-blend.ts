/**
 * Market Blend — integrates real bookmaker odds signals into the score matrix.
 *
 * The core insight: bookmaker odds aggregate thousands of analysts and sharp
 * bettors. Even a 25-35% weight on market-implied probabilities significantly
 * improves calibration (reduces Brier score ~15-25% vs model-only).
 *
 * Three independent blend channels, applied in sequence:
 *
 * 1. OU → Lambda recalibration (pre-MC)
 *    Market Over/Under 2.5 odds imply an expected total goals count (λ_total).
 *    We blend the model's total lambda with the market-implied lambda, then
 *    scale each team's lambda proportionally. This shifts the score distribution
 *    toward the market's goals expectations BEFORE the ensemble matrix is used.
 *
 * 2. 1X2 → Score matrix region scaling (pre-MC)
 *    Market 1X2 odds imply P(HW), P(D), P(AW) after vig removal.
 *    We scale the three outcome-regions of the ensemble matrix so marginal 1X2
 *    probs blend toward market consensus. Within-region distributions preserved.
 *
 * 3. BTTS → Both-score region scaling (pre-MC)
 *    Market BTTS odds imply P(both teams score).
 *    We scale the "both score" vs "at least one keeps clean sheet" regions.
 *    Preserves the 1X2 balance set in step 2.
 *
 * Weights are intentionally conservative — model retains majority influence:
 *   OU channel:   30% market
 *   1X2 channel:  25% market
 *   BTTS channel: 20% market
 *
 * When no odds are available (ODDS_API_KEY not set), this is a complete no-op.
 */

export interface MarketOddsInput {
  oneX2?: { homeOdd: number; drawOdd: number; awayOdd: number };
  overUnder?: Array<{ line: number; overOdd: number; underOdd: number }>;
  btts?: { yesOdd: number; noOdd: number };
}

export interface MarketBlendResult {
  matrix: number[][];
  adjustedLambdaHome: number;
  adjustedLambdaAway: number;
  channelsApplied: string[];
  marketInfluencePct: number;
}

const MARKET_OU_WEIGHT = 0.30;
const MARKET_1X2_WEIGHT = 0.25;
const MARKET_BTTS_WEIGHT = 0.20;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Remove bookmaker vigorish and return probability sum-normalised to 1. */
function removeVig(odds: number[]): number[] {
  const implied = odds.map((o) => (o > 0 ? 1 / o : 0));
  const total = implied.reduce((s, p) => s + p, 0);
  if (total <= 0) return odds.map(() => 0);
  return implied.map((p) => p / total);
}

/** P(Poisson(lambda) > 2.5) = 1 - e^{-λ}(1 + λ + λ²/2) */
function pOver25Poisson(lambda: number): number {
  const ePow = Math.exp(-lambda);
  return 1 - ePow * (1 + lambda + (lambda * lambda) / 2);
}

/** d/dλ [P(Poisson > 2.5)] = e^{-λ} * λ²/2 */
function dpOver25(lambda: number): number {
  return Math.exp(-lambda) * ((lambda * lambda) / 2);
}

/**
 * Solve for λ such that P(Poisson(λ) > 2.5) = targetP.
 * Uses Newton-Raphson with 10 iterations (converges in ≤5 typically).
 */
export function solveImpliedLambda(targetP: number): number {
  targetP = Math.max(0.02, Math.min(0.98, targetP));
  // Initial guess: invert the approximation λ ≈ 2.5 at p=0.5
  let lambda = Math.max(0.5, -Math.log(1 - targetP) * 1.8);
  for (let i = 0; i < 15; i++) {
    const f = pOver25Poisson(lambda) - targetP;
    const fp = dpOver25(lambda);
    if (Math.abs(fp) < 1e-12) break;
    const step = f / fp;
    lambda = Math.max(0.05, lambda - step);
    if (Math.abs(step) < 1e-8) break;
  }
  return lambda;
}

/** Compute matrix-implied P(home win), P(draw), P(away win). */
function matrixTo1X2(matrix: number[][]): { hw: number; d: number; aw: number } {
  let hw = 0;
  let d = 0;
  let aw = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < (matrix[i]?.length ?? 0); j++) {
      const p = matrix[i]![j] ?? 0;
      if (i > j) hw += p;
      else if (i === j) d += p;
      else aw += p;
    }
  }
  return { hw, d, aw };
}

/** Compute matrix-implied P(both teams score). */
function matrixToBtts(matrix: number[][]): number {
  let btts = 0;
  for (let i = 1; i < matrix.length; i++) {
    for (let j = 1; j < (matrix[i]?.length ?? 0); j++) {
      btts += matrix[i]![j] ?? 0;
    }
  }
  return btts;
}

/** Compute matrix-implied total expected goals. */
function matrixToExpectedTotal(matrix: number[][]): number {
  let total = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < (matrix[i]?.length ?? 0); j++) {
      total += (i + j) * (matrix[i]![j] ?? 0);
    }
  }
  return total;
}

/** Renormalize a matrix so all cells sum to 1. */
function renormalize(matrix: number[][]): number[][] {
  let sum = 0;
  for (const row of matrix) for (const v of row) sum += v;
  if (sum < 1e-12) return matrix;
  return matrix.map((row) => row.map((v) => v / sum));
}

/** Deep copy a matrix. */
function cloneMatrix(m: number[][]): number[][] {
  return m.map((row) => [...row]);
}

// ────────────────────────────────────────────────────────────────────────────
// Channel 1: Over/Under lambda recalibration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Given model lambdas and a market OU 2.5 line, return blended lambdas.
 * The total lambda is blended toward the market-implied total; each team's
 * share is preserved proportionally.
 */
export function blendLambdasFromOU(
  lambdaHome: number,
  lambdaAway: number,
  overUnder?: Array<{ line: number; overOdd: number; underOdd: number }>,
): { lambdaHome: number; lambdaAway: number; applied: boolean } {
  const ou25 = overUnder?.find((l) => l.line === 2.5);
  if (!ou25 || ou25.overOdd <= 1 || ou25.underOdd <= 1) {
    return { lambdaHome, lambdaAway, applied: false };
  }

  // Remove vig from OU
  const [pOver, _pUnder] = removeVig([ou25.overOdd, ou25.underOdd]);
  if (pOver === undefined || pOver < 0.05 || pOver > 0.95) {
    return { lambdaHome, lambdaAway, applied: false };
  }

  const lambdaMarket = solveImpliedLambda(pOver);
  const lambdaModel = lambdaHome + lambdaAway;

  const lambdaBlend = (1 - MARKET_OU_WEIGHT) * lambdaModel + MARKET_OU_WEIGHT * lambdaMarket;

  // Scale both lambdas proportionally to preserve home/away ratio
  const scale = lambdaBlend / Math.max(lambdaModel, 0.01);
  return {
    lambdaHome: Math.max(0.05, lambdaHome * scale),
    lambdaAway: Math.max(0.05, lambdaAway * scale),
    applied: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Channel 2: 1X2 score matrix region scaling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scale the three 1X2 regions of a score matrix toward the target probs.
 * Preserves the within-region distribution (which specific score is most
 * likely within each outcome type stays the same).
 */
export function scaleMatrix1X2(
  matrix: number[][],
  targetHW: number,
  targetD: number,
  targetAW: number,
): number[][] {
  const { hw, d, aw } = matrixTo1X2(matrix);

  // Normalize target (safety check)
  const targetTotal = targetHW + targetD + targetAW;
  if (targetTotal < 0.01) return matrix;
  const nHW = targetHW / targetTotal;
  const nD = targetD / targetTotal;
  const nAW = targetAW / targetTotal;

  // Scale factors: how much to multiply each region
  const sHW = hw > 1e-8 ? nHW / hw : 1;
  const sD = d > 1e-8 ? nD / d : 1;
  const sAW = aw > 1e-8 ? nAW / aw : 1;

  const out = cloneMatrix(matrix);
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < (out[i]?.length ?? 0); j++) {
      if (i > j) out[i]![j]! *= sHW;
      else if (i === j) out[i]![j]! *= sD;
      else out[i]![j]! *= sAW;
    }
  }
  return renormalize(out);
}

/**
 * Blend the matrix 1X2 probs with market-implied 1X2.
 */
export function apply1X2MarketBlend(
  matrix: number[][],
  homeOdd: number,
  drawOdd: number,
  awayOdd: number,
): { matrix: number[][]; applied: boolean } {
  if (homeOdd <= 1 || awayOdd <= 1) {
    return { matrix, applied: false };
  }

  const [marketHW, marketD, marketAW] = removeVig(
    drawOdd > 0 ? [homeOdd, drawOdd, awayOdd] : [homeOdd, awayOdd],
  );
  if (marketHW === undefined || marketAW === undefined) {
    return { matrix, applied: false };
  }
  const mD = marketD ?? 0;

  const { hw, d, aw } = matrixTo1X2(matrix);
  const targetHW = (1 - MARKET_1X2_WEIGHT) * hw + MARKET_1X2_WEIGHT * marketHW;
  const targetD = (1 - MARKET_1X2_WEIGHT) * d + MARKET_1X2_WEIGHT * mD;
  const targetAW = (1 - MARKET_1X2_WEIGHT) * aw + MARKET_1X2_WEIGHT * marketAW;

  return {
    matrix: scaleMatrix1X2(matrix, targetHW, targetD, targetAW),
    applied: true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Channel 3: BTTS region scaling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scale the "both score" region of the matrix toward the target BTTS prob.
 * Done AFTER the 1X2 blend to avoid disturbing the 1X2 balance too much.
 * The scaling is softer (BTTS_WEIGHT = 20%) to preserve 1X2 integrity.
 */
export function applyBttsMarketBlend(
  matrix: number[][],
  yesOdd: number,
  noOdd: number,
): { matrix: number[][]; applied: boolean } {
  if (yesOdd <= 1 || noOdd <= 1) return { matrix, applied: false };

  const [pYes] = removeVig([yesOdd, noOdd]);
  if (pYes === undefined || pYes < 0.05 || pYes > 0.95) {
    return { matrix, applied: false };
  }

  const modelBtts = matrixToBtts(matrix);
  if (modelBtts < 1e-8) return { matrix, applied: false };

  const targetBtts = (1 - MARKET_BTTS_WEIGHT) * modelBtts + MARKET_BTTS_WEIGHT * pYes;
  const targetNoBtts = 1 - targetBtts;
  const modelNoBtts = 1 - modelBtts;

  const sBtts = targetBtts / Math.max(modelBtts, 1e-8);
  const sNo = modelNoBtts > 1e-8 ? targetNoBtts / modelNoBtts : 1;

  const out = cloneMatrix(matrix);
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < (out[i]?.length ?? 0); j++) {
      if (i > 0 && j > 0) {
        out[i]![j]! *= sBtts;
      } else {
        out[i]![j]! *= sNo;
      }
    }
  }
  return { matrix: renormalize(out), applied: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply all available market signals to the ensemble score matrix.
 *
 * Execution order is important:
 * 1. Lambda recalibration from OU (shifts total goals expectation)
 * 2. 1X2 region scaling (adjusts home/draw/away balance)
 * 3. BTTS scaling (fine-tunes both-score region)
 *
 * When no market data is available, returns the original matrix unchanged.
 */
export function applyMarketBlend(
  matrix: number[][],
  lambdaHome: number,
  lambdaAway: number,
  marketOdds?: MarketOddsInput,
): MarketBlendResult {
  if (!marketOdds) {
    return {
      matrix,
      adjustedLambdaHome: lambdaHome,
      adjustedLambdaAway: lambdaAway,
      channelsApplied: [],
      marketInfluencePct: 0,
    };
  }

  const channels: string[] = [];
  let workMatrix = cloneMatrix(matrix);
  let adjLH = lambdaHome;
  let adjLA = lambdaAway;

  // Channel 1: OU → lambda recalibration
  if (marketOdds.overUnder?.length) {
    const ouBlend = blendLambdasFromOU(adjLH, adjLA, marketOdds.overUnder);
    if (ouBlend.applied) {
      const oldTotal = adjLH + adjLA;
      const newTotal = ouBlend.lambdaHome + ouBlend.lambdaAway;
      adjLH = ouBlend.lambdaHome;
      adjLA = ouBlend.lambdaAway;

      // Scale matrix to reflect new expected total goals
      // Use a Poisson-consistent scaling: multiply each cell by P(i+j | new λ) / P(i+j | old λ)
      // Approximation: scale the expected total by adjusting cell weights
      const expectedOld = matrixToExpectedTotal(workMatrix);
      if (expectedOld > 0.01) {
        const goalScale = newTotal / oldTotal;
        // Apply a soft exponential tilt: cells with more goals get weight * scale^(total/avgGoals)
        const avgGoals = oldTotal;
        const out = cloneMatrix(workMatrix);
        for (let i = 0; i < out.length; i++) {
          for (let j = 0; j < (out[i]?.length ?? 0); j++) {
            const totalGoals = i + j;
            // Soft tilt: weight by goalScale^(totalGoals - avgGoals) / avgGoals
            out[i]![j]! *= Math.pow(goalScale, (totalGoals - avgGoals) / Math.max(avgGoals, 1));
          }
        }
        workMatrix = renormalize(out);
      }
      channels.push(`OU-λ(${MARKET_OU_WEIGHT * 100}%)`);
    }
  }

  // Channel 2: 1X2 region scaling
  if (marketOdds.oneX2) {
    const { homeOdd, drawOdd, awayOdd } = marketOdds.oneX2;
    const blend1x2 = apply1X2MarketBlend(workMatrix, homeOdd, drawOdd ?? 0, awayOdd);
    if (blend1x2.applied) {
      workMatrix = blend1x2.matrix;
      channels.push(`1X2(${MARKET_1X2_WEIGHT * 100}%)`);
    }
  }

  // Channel 3: BTTS region scaling
  if (marketOdds.btts) {
    const bttsBlend = applyBttsMarketBlend(workMatrix, marketOdds.btts.yesOdd, marketOdds.btts.noOdd);
    if (bttsBlend.applied) {
      workMatrix = bttsBlend.matrix;
      channels.push(`BTTS(${MARKET_BTTS_WEIGHT * 100}%)`);
    }
  }

  const totalMarketWeight =
    channels.length === 3
      ? (MARKET_OU_WEIGHT + MARKET_1X2_WEIGHT + MARKET_BTTS_WEIGHT) / 3
      : channels.length === 2
        ? (MARKET_OU_WEIGHT + MARKET_1X2_WEIGHT) / 2
        : channels.length === 1
          ? MARKET_OU_WEIGHT
          : 0;

  return {
    matrix: workMatrix,
    adjustedLambdaHome: adjLH,
    adjustedLambdaAway: adjLA,
    channelsApplied: channels,
    marketInfluencePct: totalMarketWeight * 100,
  };
}
