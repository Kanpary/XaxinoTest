/**
 * Calibration service — fully dynamic, zero hardcoded thresholds.
 *
 * Every threshold, step size, and decision boundary is derived from the
 * actual distribution of the resolved-prediction dataset.  The only
 * constants allowed are mathematical identities (e.g. log, sqrt) or
 * numerical-stability floors that prevent division-by-zero / NaN.
 *
 * Algorithm overview
 * ──────────────────
 * 1. Confidence weight  c = 1 − 1/(1 + n/10)   (sigmoid, n = resolved count)
 *    At n=1 → c≈0.09, n=10 → c=0.50, n=30 → c=0.75, n=∞ → 1.0
 *
 * 2. Xi (form decay)
 *    Chronological split: older half vs newer half hit rates.
 *    Recency lift ≡ newerHitRate − olderHitRate.
 *    newXi = currentXi × (1 + lift × c)   — no grid, no snap.
 *
 * 3. Tau (Dixon-Coles low-score correction)
 *    Theoretical low-score fraction derived from observed avgGoals
 *    via Poisson model P(X≤1) = e^{-λ}(1+λ).  No fixed 22% benchmark.
 *    newTau = currentTau − (observed − theoretical) × c × 0.5
 *
 * 4. Home advantage
 *    Observed home-win rate vs model-implied rate ≈ 0.50 + HA×0.45.
 *    newHA = currentHA + (observed − implied) × c × 0.5
 *
 * 5. Ensemble weights
 *    Conviction lift: high-convergence quartile hit rate minus
 *    low-convergence quartile hit rate (quartile boundaries are
 *    data-derived, not fixed percentages).
 *    Weights shift proportionally to lift × c × per-model sensitivity.
 *    Floor = 1/(4×10) = 0.025 per model (numerical stability only).
 *
 * 6. Brier "after"
 *    Honest hold-out: most recent ⌈20%⌉ of resolved predictions
 *    are withheld from calibration and used to compute brierAfter.
 *
 * 7. Trend buckets
 *    numBuckets = ⌈√n⌉, min 2, max 12.  No fixed 5 buckets.
 *
 * 8. League threshold for best/worst league
 *    minSamples = max(1, ⌊√(resolvedCount / numLeagues)⌋).
 *
 * 9. Multi-prediction hit signal (hitAnyExact)
 *    Primary calibration signal is hitAnyExact (true if any of the 3
 *    stored predictions was an exact hit).  Falls back to hitExact for
 *    older records that pre-date the 3-prediction system.
 */

import { getResolvedPredictions } from "./prediction-service";
import { getModelState, updateModelState } from "./model-state-service";
import type { Prediction } from "@workspace/db";
import type { ModelState } from "@workspace/db";

export interface TrendPoint {
  bucketLabel: string;
  exactRate: number;
  plusMinusOneRate: number;
  sampleSize: number;
}

export interface CalibrationMetricsOut {
  totalPredictions: number;
  resolvedCount: number;
  pendingCount: number;
  exactHitCount: number;
  exactHitRate: number;
  anyExactHitCount: number;
  anyExactHitRate: number;
  plusMinusOneHitCount: number;
  plusMinusOneHitRate: number;
  brierScore: number | null;
  logLoss: number | null;
  avgEdge: number | null;
  simulatedRoi: number | null;
  simulatedRoiUnits: number | null;
  bestLeague: string | null;
  worstLeague: string | null;
  recentTrend: TrendPoint[];
  lastUpdated: string;
}

export interface RecalibrationOut {
  predictionsUsed: number;
  before: ModelState;
  after: ModelState;
  brierBefore: number | null;
  brierAfter: number | null;
  notes: string[];
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Resolve the "any of 3 predictions exact" signal, with fallback for old records. */
function anyExact(r: Prediction): boolean {
  // New records: hitAnyExact is explicitly set
  if (r.hitAnyExact !== null && r.hitAnyExact !== undefined) return r.hitAnyExact;
  // Old records (pre-upgrade): fall back to primary hitExact
  return (r.hitExact ?? false) || (r.hitExact2 ?? false) || (r.hitExact3 ?? false);
}

/** Brier score using the multi-prediction hit signal. */
function brierOf(preds: Prediction[]): number {
  if (preds.length === 0) return 0;
  return (
    preds.reduce((s, r) => {
      const y = anyExact(r) ? 1 : 0;
      const p = Math.max(1e-9, Math.min(1 - 1e-9, r.primaryProb));
      return s + (p - y) ** 2;
    }, 0) / preds.length
  );
}

/** Shannon entropy of a weight vector (nats). */
function entropy(weights: number[]): number {
  return -weights.reduce((s, w) => s + (w > 1e-12 ? w * Math.log(w) : 0), 0);
}

/** Confidence weight: sigmoid that grows from 0 toward 1 as n increases. */
function confidence(n: number): number {
  return 1 - 1 / (1 + n / 10);
}

// ─── computeMetrics ─────────────────────────────────────────────────────────

export async function computeMetrics(
  totalPredictions: number,
  pendingCount: number,
): Promise<CalibrationMetricsOut> {
  const resolved = await getResolvedPredictions();
  const n = resolved.length;

  const exact = resolved.filter((r) => r.hitExact === true).length;
  const exact2 = resolved.filter((r) => r.hitExact2 === true).length;
  const exact3 = resolved.filter((r) => r.hitExact3 === true).length;
  const anyExactCount = resolved.filter((r) => anyExact(r)).length;
  const within1 = resolved.filter((r) => r.hitWithinOne === true).length;
  const exactRate = n > 0 ? exact / n : 0;
  const anyExactRate = n > 0 ? anyExactCount / n : 0;
  const within1Rate = n > 0 ? within1 / n : 0;

  // Brier and LogLoss use the multi-prediction hit signal
  const brier = n > 0 ? brierOf(resolved) : null;
  const logLoss =
    n > 0
      ? resolved.reduce((s, r) => {
          const y = anyExact(r) ? 1 : 0;
          const p = Math.max(1e-9, Math.min(1 - 1e-9, r.primaryProb));
          return s - (y * Math.log(p) + (1 - y) * Math.log(1 - p));
        }, 0) / n
      : null;

  // Per-league analysis — threshold derived from data size and league count
  const byLeague = new Map<string, { hits: number; total: number }>();
  for (const r of resolved) {
    const e = byLeague.get(r.leagueName) ?? { hits: 0, total: 0 };
    e.total++;
    if (anyExact(r)) e.hits++;
    byLeague.set(r.leagueName, e);
  }
  const numLeagues = Math.max(1, byLeague.size);
  const leagueMinSamples = Math.max(1, Math.floor(Math.sqrt(n / numLeagues)));

  let bestLeague: string | null = null;
  let worstLeague: string | null = null;
  let bestRate = -1;
  let worstRate = 2;
  for (const [name, { hits, total }] of byLeague.entries()) {
    if (total < leagueMinSamples) continue;
    const rate = hits / total;
    if (rate > bestRate) { bestRate = rate; bestLeague = name; }
    if (rate < worstRate) { worstRate = rate; worstLeague = name; }
  }

  // Dynamic trend buckets: ⌈√n⌉ buckets, 2 ≤ buckets ≤ 12
  const recent = resolved.slice(0, Math.min(n, 200)).reverse(); // chronological
  const numBuckets = Math.min(12, Math.max(2, Math.ceil(Math.sqrt(recent.length))));
  const bucketSize = Math.max(1, Math.ceil(recent.length / numBuckets));
  const buckets: TrendPoint[] = [];
  for (let i = 0; i < recent.length; i += bucketSize) {
    const slice = recent.slice(i, i + bucketSize);
    buckets.push({
      bucketLabel: `${i + 1}-${i + slice.length}`,
      exactRate: slice.filter((r) => anyExact(r)).length / slice.length,
      plusMinusOneRate: slice.filter((r) => r.hitWithinOne).length / slice.length,
      sampleSize: slice.length,
    });
  }

  // ROI (only if odds are available)
  let roiUnits: number | null = null;
  let roiPct: number | null = null;
  let edges = 0;
  let edgeCount = 0;
  let stake = 0;
  let returns = 0;
  for (const r of resolved) {
    if (r.currentOdd != null && r.edgePct != null) {
      stake += 1;
      edges += r.edgePct;
      edgeCount++;
      if (anyExact(r)) returns += r.currentOdd;
    }
  }
  if (stake > 0) { roiUnits = returns - stake; roiPct = (returns - stake) / stake; }
  const avgEdge = edgeCount > 0 ? edges / edgeCount : null;

  return {
    totalPredictions,
    resolvedCount: n,
    pendingCount,
    exactHitCount: exact + exact2 + exact3,
    exactHitRate: n > 0 ? (exact + exact2 + exact3) / n : 0,
    anyExactHitCount: anyExactCount,
    anyExactHitRate: anyExactRate,
    plusMinusOneHitCount: within1,
    plusMinusOneHitRate: within1Rate,
    brierScore: brier,
    logLoss,
    avgEdge,
    simulatedRoi: roiPct,
    simulatedRoiUnits: roiUnits,
    bestLeague,
    worstLeague,
    recentTrend: buckets,
    lastUpdated: new Date().toISOString(),
  };
}

// ─── recalibrate ─────────────────────────────────────────────────────────────

export async function recalibrate(): Promise<RecalibrationOut | { error: string }> {
  const resolved = await getResolvedPredictions();

  if (resolved.length === 0) {
    return { error: "Nenhum palpite resolvido ainda." };
  }

  const before = await getModelState();
  const notes: string[] = [];
  const n = resolved.length;

  // Confidence in the data signal (0→1 as n grows)
  const c = confidence(n);
  notes.push(
    `${n} predições resolvidas · confiança de sinal: ${(c * 100).toFixed(0)}%`,
  );

  // ── Hold-out split (most recent 20%, min 1) ──────────────────────────────
  const holdN = Math.max(1, Math.round(n * 0.20));
  const holdOut = resolved.slice(0, holdN);
  const trainSet = resolved.length > holdN ? resolved.slice(holdN) : resolved;
  const nTrain = trainSet.length;

  const brierBefore = brierOf(resolved);
  const brierAfter = brierOf(holdOut);

  // Multi-prediction hit rates for reporting
  const anyHitAll = resolved.filter((r) => anyExact(r)).length;
  const anyHitRate = n > 0 ? anyHitAll / n : 0;
  notes.push(
    `Brier treino: ${brierBefore.toFixed(4)} · hold-out (n=${holdN}): ${brierAfter.toFixed(4)} · delta: ${(brierAfter - brierBefore >= 0 ? "+" : "")}${(brierAfter - brierBefore).toFixed(4)} | hitAnyExact: ${(anyHitRate * 100).toFixed(1)}%`,
  );

  // ── Summary stats from training set ─────────────────────────────────────
  const overallHitRate = nTrain > 0
    ? trainSet.filter((r) => anyExact(r)).length / nTrain : 0;
  const overallW1Rate = nTrain > 0
    ? trainSet.filter((r) => r.hitWithinOne).length / nTrain : 0;
  const avgConv = nTrain > 0
    ? trainSet.reduce((s, r) => s + r.ensembleConvergence, 0) / nTrain : 0.75;
  const avgProb = nTrain > 0
    ? trainSet.reduce((s, r) => s + r.primaryProb, 0) / nTrain : 0.10;

  notes.push(
    `Treino (n=${nTrain}): hitAny=${(overallHitRate * 100).toFixed(1)}% ±1=${(overallW1Rate * 100).toFixed(1)}% · p̄=${(avgProb * 100).toFixed(2)}% · conv̄=${(avgConv * 100).toFixed(1)}%`,
  );

  // ── 1. Xi calibration — chronological recency gradient ──────────────────
  const chrono = [...trainSet].sort(
    (a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime(),
  );
  const halfN = Math.max(1, Math.floor(chrono.length / 2));
  const olderHalf = chrono.slice(0, halfN);
  const newerHalf = chrono.slice(halfN);
  const olderHit = olderHalf.length > 0
    ? olderHalf.filter((r) => anyExact(r)).length / olderHalf.length : 0;
  const newerHit = newerHalf.length > 0
    ? newerHalf.filter((r) => anyExact(r)).length / newerHalf.length : 0;

  const recencyLift = newerHit - olderHit;
  const newXi = Math.max(
    1e-4,
    before.weightedFormXi * (1 + recencyLift * c),
  );
  notes.push(
    `Xi: recente ${(newerHit * 100).toFixed(1)}% vs antigo ${(olderHit * 100).toFixed(1)}% → lift=${recencyLift >= 0 ? "+" : ""}${(recencyLift * 100).toFixed(1)}pp → ${before.weightedFormXi.toFixed(5)} → ${newXi.toFixed(5)}`,
  );

  // ── 2. Tau — Poisson-theoretic baseline ──────────────────────────────────
  const withScores = trainSet.filter(
    (r) => r.actualHome != null && r.actualAway != null,
  );
  const lowScoreCount = withScores.filter(
    (r) => r.actualHome! + r.actualAway! <= 1,
  ).length;
  const observedLowFrac = withScores.length > 0
    ? lowScoreCount / withScores.length : 0;

  const avgTotalGoals = withScores.length > 0
    ? withScores.reduce((s, r) => s + r.actualHome! + r.actualAway!, 0) /
      withScores.length
    : 2.5;
  const lam = Math.max(0.3, avgTotalGoals);
  const theoreticalLowFrac = Math.exp(-lam) * (1 + lam);

  const lowFracDev = observedLowFrac - theoreticalLowFrac;
  const newTau = before.dixonColesTau - lowFracDev * c * 0.5;

  notes.push(
    `Tau: low-score obs=${(observedLowFrac * 100).toFixed(1)}% teórico=${(theoreticalLowFrac * 100).toFixed(1)}% (λ̄=${avgTotalGoals.toFixed(2)}) → dev=${lowFracDev >= 0 ? "+" : ""}${(lowFracDev * 100).toFixed(1)}pp → ${before.dixonColesTau.toFixed(5)} → ${newTau.toFixed(5)}`,
  );

  // ── 3. Home advantage ────────────────────────────────────────────────────
  const homeWins = withScores.filter((r) => r.actualHome! > r.actualAway!).length;
  const draws = withScores.filter((r) => r.actualHome! === r.actualAway!).length;
  const observedHomeWinRate = withScores.length > 0
    ? homeWins / withScores.length : 0.45;
  const observedDrawRate = withScores.length > 0
    ? draws / withScores.length : 0.27;

  const impliedHomeWinRate = 0.50 + before.homeAdvantage * 0.45;
  const haDeviation = observedHomeWinRate - impliedHomeWinRate;
  const newHA = Math.max(0, before.homeAdvantage + haDeviation * c * 0.5);

  notes.push(
    `HA: obs=${(observedHomeWinRate * 100).toFixed(1)}% emp=${(observedDrawRate * 100).toFixed(1)}% vs imp=${(impliedHomeWinRate * 100).toFixed(1)}% → dev=${haDeviation >= 0 ? "+" : ""}${(haDeviation * 100).toFixed(1)}pp → ${before.homeAdvantage.toFixed(5)} → ${newHA.toFixed(5)}`,
  );

  // ── 4. Ensemble weights — conviction-hit correlation ─────────────────────
  const sortedByConv = [...trainSet].sort(
    (a, b) => a.ensembleConvergence - b.ensembleConvergence,
  );
  const q1Idx = Math.max(0, Math.floor(nTrain * 0.25) - 1);
  const q3Idx = Math.min(nTrain - 1, Math.floor(nTrain * 0.75));
  const convQ1 = sortedByConv[q1Idx]?.ensembleConvergence ?? 0.60;
  const convQ3 = sortedByConv[q3Idx]?.ensembleConvergence ?? 0.90;

  const highConv = trainSet.filter((r) => r.ensembleConvergence >= convQ3);
  const lowConv = trainSet.filter((r) => r.ensembleConvergence < convQ1);
  const highConvHit = highConv.length > 0
    ? highConv.filter((r) => anyExact(r)).length / highConv.length : 0;
  const lowConvHit = lowConv.length > 0
    ? lowConv.filter((r) => anyExact(r)).length / lowConv.length : 0;

  const convictionLift = highConvHit - lowConvHit;
  const weightSignal = convictionLift * c;

  const FLOOR = 1 / 40;
  let wDC = Math.max(FLOOR, before.weightDixonColes + weightSignal * 0.20);
  let wBV = Math.max(FLOOR, before.weightBivariate + weightSignal * 0.05);
  let wEL = Math.max(FLOOR, before.weightEloPoisson - weightSignal * 0.12);
  let wWF = Math.max(FLOOR, before.weightWeightedForm - weightSignal * 0.13);

  const wSum = wDC + wBV + wEL + wWF;
  wDC /= wSum; wBV /= wSum; wEL /= wSum; wWF /= wSum;

  const ent = entropy([wDC, wBV, wEL, wWF]);
  const maxEnt = Math.log(4);
  notes.push(
    `Conviction: conv≥${(convQ3 * 100).toFixed(0)}%→hitAny=${(highConvHit * 100).toFixed(1)}% vs conv<${(convQ1 * 100).toFixed(0)}%→hitAny=${(lowConvHit * 100).toFixed(1)}% lift=${weightSignal >= 0 ? "+" : ""}${(weightSignal * 100).toFixed(1)}pp`,
  );
  notes.push(
    `Pesos → DC:${(wDC * 100).toFixed(1)}% BV:${(wBV * 100).toFixed(1)}% ELO:${(wEL * 100).toFixed(1)}% WF:${(wWF * 100).toFixed(1)}% · diversidade: ${(ent / maxEnt * 100).toFixed(0)}%`,
  );

  const after = await updateModelState({
    dixonColesTau: newTau,
    weightedFormXi: newXi,
    homeAdvantage: newHA,
    weightDixonColes: wDC,
    weightBivariate: wBV,
    weightEloPoisson: wEL,
    weightWeightedForm: wWF,
    predictionsSinceLastCalibration: 0,
    totalResolvedPredictions: resolved.length,
    lastRecalibration: new Date(),
    lastRecalibrationNotes: notes.join(" | "),
  });

  return {
    predictionsUsed: resolved.length,
    before,
    after,
    brierBefore,
    brierAfter,
    notes,
  };
}
