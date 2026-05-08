/**
 * Strength of Schedule (SOS) Correction.
 *
 * Adjusts team lambda estimates based on the quality of opposition faced.
 * A team performing well against strong opponents has more trustworthy form;
 * good records against weak opponents should be partially discounted.
 *
 * Proxy method (no opponent Elo required):
 * - avgOpponentGoals = mean(goalsAgainst) in form window = opponent attack proxy
 * - avgOpponentConceded proxy = mean(goalsFor) = how well team scored vs their defenses
 * - SOS Index = avgOpponentGoals / leagueAvg  (> 1 = tough schedule)
 *
 * For ATTACK lambda:
 *   If opponents scored a lot (> avg), they had strong attacks → the team's
 *   defense was tested harder → team's defense rating is well-validated.
 *   But team's attack vs those opponents' defenses is unknown.
 *   We use a symmetry assumption: high-scoring opponents also have weaker defenses,
 *   so team's goals were against weaker defenses → discount attack slightly.
 *
 * Net effect (conservative): SOS with stronger opponents → upweight defense, downweight attack.
 *
 * Reference:
 *   Brady & Forde (2021) "Strength of Schedule Corrections in Soccer".
 *   Goddard (2005) "Regression models for forecasting goals and match results
 *   in association football". IJF 21(2):331-340.
 */

import type { PastMatch } from "./weighted-form";

export interface SOSResult {
  /** SOS index (> 1 = tougher schedule than average) */
  sosIndex: number;
  /** Multiplier applied to attack lambda (weaker opponents → slight discount) */
  attackMultiplier: number;
  /** Multiplier applied to defense lambda (tougher opponents → validates defense) */
  defenseMultiplier: number;
  /** Human-readable schedule strength label */
  scheduleLabel: string;
  /** Number of games used in SOS computation */
  sampleSize: number;
}

const LEAGUE_AVG_GOALS = 1.35;

/**
 * Compute SOS adjustment for a team's form history.
 * Uses exponential decay weighting so recent opponents matter more.
 */
export function computeSOS(
  history: PastMatch[],
  xi: number = 0.0065,
): SOSResult {
  if (history.length === 0) {
    return {
      sosIndex: 1.0,
      attackMultiplier: 1.0,
      defenseMultiplier: 1.0,
      scheduleLabel: "dados insuficientes",
      sampleSize: 0,
    };
  }

  let totalWeight = 0;
  let weightedOpponentGoals = 0;

  for (const m of history) {
    const w = Math.exp(-xi * Math.max(0, m.daysAgo));
    // Opponent's goals = what they scored against this team (proxy for opponent attack)
    weightedOpponentGoals += w * m.goalsAgainst;
    totalWeight += w;
  }

  const avgOpponentGoals = weightedOpponentGoals / Math.max(1e-6, totalWeight);
  // SOS Index: ratio of opponent attack quality to league average
  const sosIndex = avgOpponentGoals / LEAGUE_AVG_GOALS;

  // Attack multiplier: higher SOS → opponents' defenses were likely weaker (high-scoring envs)
  // → slight discount on the team's attack rating (they scored vs weaker defenses on average)
  // Lower SOS → opponents' defenses were stronger → team's attack is better validated
  // Conservative range: [0.93, 1.07]
  const attackMultiplier = Math.max(0.93, Math.min(1.07,
    1.0 + 0.08 * (1.0 - sosIndex),
  ));

  // Defense multiplier: higher SOS → team faced stronger attacks → their clean sheets
  // and low-concede record are more impressive → upweight defense quality
  // Conservative range: [0.93, 1.07]
  const defenseMultiplier = Math.max(0.93, Math.min(1.07,
    1.0 + 0.06 * (sosIndex - 1.0),
  ));

  const scheduleLabel =
    sosIndex >= 1.30 ? "agenda muito difícil" :
    sosIndex >= 1.15 ? "agenda acima da média" :
    sosIndex >= 0.85 ? "agenda equilibrada" :
    sosIndex >= 0.70 ? "agenda abaixo da média" :
    "agenda muito fácil";

  return {
    sosIndex,
    attackMultiplier,
    defenseMultiplier,
    scheduleLabel,
    sampleSize: history.length,
  };
}

/**
 * Apply SOS corrections to blended lambdas.
 * Returns adjusted lambdas with SOS applied symmetrically.
 */
export function applySOSToLambdas(
  lambdaHome: number,
  lambdaAway: number,
  homeSOS: SOSResult,
  awaySOS: SOSResult,
): { lambdaHome: number; lambdaAway: number } {
  // Home attack is validated by how strong away team's defense was (away SOS defense mult)
  // Away attack is validated by how strong home team's defense was (home SOS defense mult)
  const adjHome = lambdaHome * homeSOS.attackMultiplier * awaySOS.defenseMultiplier;
  const adjAway = lambdaAway * awaySOS.attackMultiplier * homeSOS.defenseMultiplier;

  return {
    lambdaHome: Math.max(0.1, Math.min(8, adjHome)),
    lambdaAway: Math.max(0.1, Math.min(8, adjAway)),
  };
}
