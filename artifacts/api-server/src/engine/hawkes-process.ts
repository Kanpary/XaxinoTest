/**
 * Hawkes Self-Exciting Process for Football Goals
 *
 * Methods implemented:
 * M34 — Hawkes Process (self-exciting — goals beget goals)
 * M35 — Goal Timing Distribution (empirical + parametric)
 * M36 — Dixon-Robinson Live Model (time-varying intensities)
 *
 * References:
 *   Hawkes (1971) "Spectra of some self-exciting and mutually exciting point processes"
 *   Dixon & Robinson (1998) "A birth process model for association football matches"
 *   Armatas et al (2007) "Analysis of the goals scored in the 2006 World Cup Soccer"
 */

export interface HawkesInput {
  /** Pre-match Poisson lambda (per 90min) */
  lambdaHome: number;
  lambdaAway: number;
  /** Live match state (undefined = pre-match) */
  minutesElapsed?: number;
  currentHomeGoals?: number;
  currentAwayGoals?: number;
  /** Goal events with timing (for calibrated Hawkes) */
  goalEvents?: Array<{ time: number; team: "home" | "away" }>;
}

export interface HawkesResult {
  /** Projected final score considering self-excitation */
  projectedHome: number;
  projectedAway: number;
  /** Score probability matrix */
  scoreMatrix: number[][];
  /** Hawkes parameters */
  mu: number;        // base intensity (per 90min)
  alpha: number;     // excitation magnitude
  beta: number;      // excitation decay rate
  /** Current instantaneous intensity */
  currentIntensityHome: number;
  currentIntensityAway: number;
  /** Probability of at least one more goal (remaining time) */
  probAnotherGoal: number;
  /** Goal timing analysis */
  goalTimingWeights: Record<string, number>;
}

/** Empirical goal timing distribution (% of goals scored in each period)
 *  Based on Armatas et al (2007) and UEFA Technical Reports
 */
const GOAL_TIMING_DIST: Array<{ label: string; from: number; to: number; weight: number }> = [
  { label: "1-15",    from: 1,  to: 15, weight: 0.097 },
  { label: "16-30",   from: 16, to: 30, weight: 0.113 },
  { label: "31-45+",  from: 31, to: 45, weight: 0.143 },
  { label: "46-60",   from: 46, to: 60, weight: 0.131 },
  { label: "61-75",   from: 61, to: 75, weight: 0.164 },
  { label: "76-90+",  from: 76, to: 95, weight: 0.252 }, // highest — fatigue + urgency
  { label: "ET",      from: 91, to: 93, weight: 0.100 }, // extra time / added time pool
];

/** Poisson PMF */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Hawkes intensity at time t, given previous goal events
 * λ(t) = μ + α × Σ_{t_i < t} exp(-β(t - t_i))
 */
function hawkesIntensity(
  mu: number,
  alpha: number,
  beta: number,
  currentTime: number,
  events: Array<{ time: number }>,
): number {
  let excitation = 0;
  for (const ev of events) {
    if (ev.time < currentTime) {
      excitation += alpha * Math.exp(-beta * (currentTime - ev.time));
    }
  }
  return mu + excitation;
}

/**
 * Expected additional goals from time t to T using Hawkes
 * E[N(t,T)] = μ·(T-t)/90 + (α/β)·(1 − exp(−β·(T-t)))·currentExcitation
 *
 * Units:
 *   mu            — goals per 90-min match (caller passes muHome * 90)
 *   beta          — per-minute decay (= 0.09 /min, consistent with hawkesIntensity)
 *   currentTime, endTime — both in minutes
 *
 * Fix 14: dtMin = (T-t) in minutes is used for the beta exponential decay;
 *   previously dt was normalised to [0,1] which underweighted excitation ~22×.
 *   dt (fraction) is still used for the base-rate multiplication (mu × fraction).
 */
function hawkesExpectedRemaining(
  mu: number,
  alpha: number,
  beta: number,
  currentTime: number,
  endTime: number,
  currentExcitation: number,
): number {
  const dtMin = Math.max(0, endTime - currentTime);   // remaining minutes (for β)
  const dt    = dtMin / 90;                            // remaining fraction (for base rate)
  const baseRate    = mu * dt;
  const excitedRate = (alpha / Math.max(beta, 0.01)) * (1 - Math.exp(-beta * dtMin)) * currentExcitation;
  return baseRate + excitedRate;
}

export function computeHawkes(input: HawkesInput): HawkesResult {
  const {
    lambdaHome,
    lambdaAway,
    minutesElapsed = 0,
    currentHomeGoals = 0,
    currentAwayGoals = 0,
    goalEvents = [],
  } = input;

  // Hawkes parameters calibrated to football
  // μ ≈ 0.8 × lambda/90 (base rate without excitation), in goals/minute
  // β ≈ 0.09 /min  (half-life ≈ 7.7 min — excitation fades within ~15 min)
  // α = 0.013 /min (recalibrated alongside Fix 14 — before fix, alpha=0.28 was
  //   tuned against a normalised dt=dtMin/90, making excitation ~22× too small.
  //   New alpha preserves the same effective self-excitement level with the
  //   corrected dt_minutes integration, giving α/β ≈ 0.14 extra goals per event
  //   — consistent with football Hawkes literature.)
  const muHome = 0.80 * lambdaHome / 90;
  const muAway = 0.80 * lambdaAway / 90;
  const alpha = 0.013;  // Fix 14: recalibrated (was 0.28 under buggy normalised dt)
  const beta = 0.09;    // per-minute decay (unchanged)

  // Split goal events by team
  const homeEvents = goalEvents.filter((e) => e.team === "home");
  const awayEvents = goalEvents.filter((e) => e.team === "away");

  // If no explicit goal events but we have score, infer uniform-distributed events
  const inferredHomeEvents: Array<{ time: number }> =
    homeEvents.length > 0
      ? homeEvents
      : currentHomeGoals > 0
        ? Array.from({ length: currentHomeGoals }, (_, i) =>
            ({ time: (minutesElapsed / (currentHomeGoals + 1)) * (i + 1) }),
          )
        : [];

  const inferredAwayEvents: Array<{ time: number }> =
    awayEvents.length > 0
      ? awayEvents
      : currentAwayGoals > 0
        ? Array.from({ length: currentAwayGoals }, (_, i) =>
            ({ time: (minutesElapsed / (currentAwayGoals + 1)) * (i + 1) }),
          )
        : [];

  // Current instantaneous intensities
  const currentIntensityHome = hawkesIntensity(muHome, alpha, beta, minutesElapsed, inferredHomeEvents);
  const currentIntensityAway = hawkesIntensity(muAway, alpha, beta, minutesElapsed, inferredAwayEvents);

  // Current excitation level (summed decayed events)
  const homeExcitation = inferredHomeEvents.reduce(
    (sum, ev) => sum + Math.exp(-beta * (minutesElapsed - ev.time)),
    0,
  );
  const awayExcitation = inferredAwayEvents.reduce(
    (sum, ev) => sum + Math.exp(-beta * (minutesElapsed - ev.time)),
    0,
  );

  // Expected remaining goals (Hawkes-corrected)
  const endTime = 90;
  const expectedRemainingHome = hawkesExpectedRemaining(
    muHome * 90, alpha, beta, minutesElapsed, endTime, homeExcitation,
  );
  const expectedRemainingAway = hawkesExpectedRemaining(
    muAway * 90, alpha, beta, minutesElapsed, endTime, awayExcitation,
  );

  const projectedHome = currentHomeGoals + Math.max(0, expectedRemainingHome);
  const projectedAway = currentAwayGoals + Math.max(0, expectedRemainingAway);

  // Probability of at least one more goal in remaining time
  const probNoMoreGoals = Math.exp(-(expectedRemainingHome + expectedRemainingAway));
  const probAnotherGoal = 1 - probNoMoreGoals;

  // Score probability matrix
  const maxGoals = 8;
  const scoreMatrix: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    scoreMatrix[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const hRemain = Math.max(0, h - currentHomeGoals);
      const aRemain = Math.max(0, a - currentAwayGoals);
      if (h < currentHomeGoals || a < currentAwayGoals) {
        scoreMatrix[h][a] = 0;
      } else {
        scoreMatrix[h][a] =
          poissonPMF(hRemain, Math.max(0.01, expectedRemainingHome)) *
          poissonPMF(aRemain, Math.max(0.01, expectedRemainingAway));
      }
    }
  }

  // Goal timing weights (which periods remaining are hottest)
  const goalTimingWeights: Record<string, number> = {};
  for (const period of GOAL_TIMING_DIST) {
    if (period.to > minutesElapsed) {
      const remainingFrac = Math.min(1, (period.to - Math.max(period.from, minutesElapsed)) / (period.to - period.from));
      goalTimingWeights[period.label] = period.weight * remainingFrac;
    }
  }

  return {
    projectedHome,
    projectedAway,
    scoreMatrix,
    mu: muHome * 90,
    alpha,
    beta,
    currentIntensityHome,
    currentIntensityAway,
    probAnotherGoal,
    goalTimingWeights,
  };
}

/**
 * M36 — Dixon-Robinson live model
 * Time-varying intensities that depend on current score state
 * Situational multipliers: trailing team attacks harder, leading team may defend
 */
export interface DixonRobinsonResult {
  adjustedLambdaHome: number;
  adjustedLambdaAway: number;
  situationalState: string;
  intensityMultiplierHome: number;
  intensityMultiplierAway: number;
}

export function dixonRobinsonLive(
  baseLambdaHome: number,
  baseLambdaAway: number,
  minutesElapsed: number,
  homeGoals: number,
  awayGoals: number,
): DixonRobinsonResult {
  const remaining = 90 - minutesElapsed;
  const urgency = remaining < 15 ? 1.35 : remaining < 30 ? 1.15 : 1.0;
  const diff = homeGoals - awayGoals;

  let homeMultiplier = 1.0;
  let awayMultiplier = 1.0;
  let state = "neutral";

  if (diff === 0) {
    // Level — both push slightly
    homeMultiplier = 1.05;
    awayMultiplier = 1.05;
    state = "level";
  } else if (diff === -1) {
    // Home trails by 1 → attacks hard; away defends
    homeMultiplier = 1.20 * urgency;
    awayMultiplier = 0.85;
    state = "home_trailing_1";
  } else if (diff <= -2) {
    // Home trails by 2+ → desperation
    homeMultiplier = 1.35 * urgency;
    awayMultiplier = 0.75;
    state = "home_trailing_2plus";
  } else if (diff === 1) {
    // Home leads by 1 → may sit back; away attacks
    homeMultiplier = 0.85;
    awayMultiplier = 1.20 * urgency;
    state = "home_leading_1";
  } else {
    // Home leads by 2+ → comfortable
    homeMultiplier = 0.70;
    awayMultiplier = 1.35 * urgency;
    state = "home_leading_2plus";
  }

  return {
    adjustedLambdaHome: Math.max(0.05, baseLambdaHome * homeMultiplier),
    adjustedLambdaAway: Math.max(0.05, baseLambdaAway * awayMultiplier),
    situationalState: state,
    intensityMultiplierHome: homeMultiplier,
    intensityMultiplierAway: awayMultiplier,
  };
}
