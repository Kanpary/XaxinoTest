/**
 * Live Match Context — Bayesian Update & Red Card Models
 *
 * Methods implemented:
 * M54 — Bayesian Live Score Update (pre-match prior → live posterior)
 * M55 — Red Card Impact Model (10v11 → lambda adjustment)
 * M56 — Substitution Impact Model (tactical change detection)
 * M57 — Injury Time Prediction (added time estimation)
 *
 * References:
 *   Rue & Salvesen (2000) "Prediction and retrospective analysis of soccer matches"
 *   Dixon & Robinson (1998) "A birth process model for association football matches"
 *   Lago-Peñas et al (2016) "The influence of substitutions on elite soccer teams' performance"
 */

export interface LiveContextInput {
  /** Pre-match model score matrix [home][away] */
  priorScoreMatrix: number[][];
  /** Current match state */
  minutesElapsed: number;
  currentHomeGoals: number;
  currentAwayGoals: number;
  /** Red cards */
  homeRedCards: number;
  awayRedCards: number;
  /** Substitutions made */
  homeSubstitutions?: number;
  awaySubstitutions?: number;
  /** Live xG accumulation (if available) */
  liveHomeXg?: number;
  liveAwayXg?: number;
  /** Base lambdas from pre-match model */
  baseLambdaHome: number;
  baseLambdaAway: number;
}

export interface LiveContextResult {
  /** Posterior score matrix (updated with live state) */
  posteriorScoreMatrix: number[][];
  /** Posterior lambdas for remaining time */
  remainingLambdaHome: number;
  remainingLambdaAway: number;
  /** Red card adjustments */
  redCardLambdaHome: number;
  redCardLambdaAway: number;
  /** Effective remaining minutes */
  remainingMinutes: number;
  /** Probability of each final score given current state */
  topScoresFinal: Array<{ home: number; away: number; prob: number }>;
  /** Market impact indicators */
  liveHomeWinProb: number;
  liveDrawProb: number;
  liveAwayWinProb: number;
  /** Estimated injury time */
  estimatedInjuryTime: number;
  /** Substitution impact factor */
  subImpactHome: number;
  subImpactAway: number;
}

/** Poisson PMF */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Red card lambda multiplier
 * 10-man team: -30% attacking output, opponent +15% (space opens)
 * Each additional red card compounds the effect
 */
function redCardMultiplier(
  ownCards: number,
  oppCards: number,
): { ownMult: number; oppMult: number } {
  const ownPenalty = Math.min(0.55, ownCards * 0.30); // -30% per card, max -55%
  const oppBoost = Math.min(0.20, ownCards * 0.12);   // +12% per opp card down

  // If both teams have reds, effects partially cancel
  const netOppPenalty = Math.min(0.55, oppCards * 0.30);
  const netOwnBoost = Math.min(0.20, oppCards * 0.12);

  return {
    ownMult: Math.max(0.30, 1 - ownPenalty + netOwnBoost),
    oppMult: Math.max(0.70, 1 + oppBoost - netOppPenalty),
  };
}

/**
 * Substitution impact multiplier
 * Early subs (before 60') suggest injury or tactical — mixed impact
 * Late attacking subs (75'+) → +5-8% attacking output
 */
function substitutionImpact(subsMade: number, minutesElapsed: number): number {
  if (subsMade === 0) return 1.0;
  if (minutesElapsed < 60) return 0.98; // early sub = disruption/injury
  if (minutesElapsed < 75) return 1.02; // fresh legs
  return 1.0 + (subsMade * 0.025); // late attacking subs
}

/**
 * Injury time estimation
 * Based on: goals scored, red cards, substitutions, VAR checks
 * Reference: Trewin (2022) "Determinants of injury time in English Premier League"
 */
function estimateInjuryTime(
  totalGoals: number,
  redCards: number,
  totalSubs: number,
  isSecondHalf: boolean,
): number {
  const base = isSecondHalf ? 4 : 2;
  const goalAddition = totalGoals * 0.4;
  const cardAddition = redCards * 1.5;
  const subAddition = totalSubs * 0.3;
  return Math.max(base, Math.round(base + goalAddition + cardAddition + subAddition));
}

/**
 * Bayesian posterior update:
 * P(final | current_state) ∝ P(current_state | final) × P(final)
 * P(current_state | final) = Poisson(h, λ_H × t/90) × Poisson(a, λ_A × t/90)
 */
export function computeLiveContext(input: LiveContextInput): LiveContextResult {
  const {
    priorScoreMatrix,
    minutesElapsed,
    currentHomeGoals,
    currentAwayGoals,
    homeRedCards,
    awayRedCards,
    homeSubstitutions = 0,
    awaySubstitutions = 0,
    liveHomeXg,
    liveAwayXg,
    baseLambdaHome,
    baseLambdaAway,
  } = input;

  const maxGoals = priorScoreMatrix.length - 1;
  const remainingMinutes = Math.max(0, 90 - minutesElapsed);
  const elapsedFraction = minutesElapsed / 90;
  const remainingFraction = remainingMinutes / 90;

  // Red card adjustments
  const homeRedEffect = redCardMultiplier(homeRedCards, awayRedCards);
  const awayRedEffect = redCardMultiplier(awayRedCards, homeRedCards);
  const redCardLambdaHome = baseLambdaHome * homeRedEffect.ownMult;
  const redCardLambdaAway = baseLambdaAway * awayRedEffect.ownMult;

  // Substitution impact
  const subImpactHome = substitutionImpact(homeSubstitutions, minutesElapsed);
  const subImpactAway = substitutionImpact(awaySubstitutions, minutesElapsed);

  // If live xG available, blend it with model lambda (xG is better evidence)
  let adjLambdaHome = redCardLambdaHome * subImpactHome;
  let adjLambdaAway = redCardLambdaAway * subImpactAway;

  if (liveHomeXg !== undefined && minutesElapsed >= 15) {
    // FIX: elapsedFraction = minutesElapsed/90 is always < 1 during a match.
    // Math.max(1, elapsedFraction) was always 1 — xG was never annualized.
    // Correct: divide by elapsedFraction to get the per-90-min xG rate.
    // Floor at 0.15 (≈ 13.5 min) to avoid exploding early-game rates.
    const xgRate = liveHomeXg / Math.max(0.15, elapsedFraction);
    const blendWeight = Math.min(0.6, elapsedFraction); // more weight to xG as game progresses
    adjLambdaHome = adjLambdaHome * (1 - blendWeight) + xgRate * blendWeight;
  }
  if (liveAwayXg !== undefined && minutesElapsed >= 15) {
    const xgRate = liveAwayXg / Math.max(0.15, elapsedFraction);
    const blendWeight = Math.min(0.6, elapsedFraction);
    adjLambdaAway = adjLambdaAway * (1 - blendWeight) + xgRate * blendWeight;
  }

  // Remaining lambdas (scaled to remaining time)
  const remainingLambdaHome = Math.max(0, adjLambdaHome * remainingFraction);
  const remainingLambdaAway = Math.max(0, adjLambdaAway * remainingFraction);

  // Bayesian posterior: P(final=H,A | current=h0,a0, remaining=λR_H,λR_A)
  const posteriorScoreMatrix: number[][] = Array.from({ length: maxGoals + 1 }, () =>
    new Array(maxGoals + 1).fill(0),
  );

  let totalWeight = 0;
  for (let finalH = currentHomeGoals; finalH <= maxGoals; finalH++) {
    for (let finalA = currentAwayGoals; finalA <= maxGoals; finalA++) {
      const remainH = finalH - currentHomeGoals;
      const remainA = finalA - currentAwayGoals;
      // Posterior: prior × likelihood of remaining goals given adjusted lambda
      const prior = priorScoreMatrix[finalH]?.[finalA] ?? 0;
      const likelihood =
        poissonPMF(remainH, Math.max(0.001, remainingLambdaHome)) *
        poissonPMF(remainA, Math.max(0.001, remainingLambdaAway));
      posteriorScoreMatrix[finalH][finalA] = prior * likelihood;
      totalWeight += posteriorScoreMatrix[finalH][finalA];
    }
  }

  // Normalize
  if (totalWeight > 0) {
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        posteriorScoreMatrix[h][a] /= totalWeight;
      }
    }
  }

  // 1X2 live probabilities
  let liveHomeWinProb = 0;
  let liveDrawProb = 0;
  let liveAwayWinProb = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = posteriorScoreMatrix[h][a];
      if (h > a) liveHomeWinProb += p;
      else if (h === a) liveDrawProb += p;
      else liveAwayWinProb += p;
    }
  }

  // Top scores
  const flat: Array<{ home: number; away: number; prob: number }> = [];
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      if (posteriorScoreMatrix[h][a] > 0.001) {
        flat.push({ home: h, away: a, prob: posteriorScoreMatrix[h][a] });
      }
    }
  }
  flat.sort((a, b) => b.prob - a.prob);

  // Injury time
  const isSecondHalf = minutesElapsed >= 45;
  const estimatedInjuryTime = estimateInjuryTime(
    currentHomeGoals + currentAwayGoals,
    homeRedCards + awayRedCards,
    homeSubstitutions + awaySubstitutions,
    isSecondHalf,
  );

  return {
    posteriorScoreMatrix,
    remainingLambdaHome,
    remainingLambdaAway,
    redCardLambdaHome,
    redCardLambdaAway,
    remainingMinutes,
    topScoresFinal: flat.slice(0, 10),
    liveHomeWinProb,
    liveDrawProb,
    liveAwayWinProb,
    estimatedInjuryTime,
    subImpactHome,
    subImpactAway,
  };
}
