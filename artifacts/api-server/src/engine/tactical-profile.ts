/**
 * Tactical Profile Classifier.
 *
 * Classifies each team's tactical style from their form history and derives
 * lambda multipliers for the specific matchup style clash.
 *
 * Style classification based on:
 *   - scoringRate: goals scored per game (attack intensity)
 *   - concedingRate: goals conceded per game (defensive solidity)
 *   - cleanSheetRate: fraction of games with 0 conceded (defensive structure)
 *   - failedToScoreRate: fraction of scoreless games (offensive reliability)
 *   - blowoutRate: fraction of high-goal-total games (open-game tendency)
 *   - scoringVariance: coefficient of variation of goals (explosiveness vs consistency)
 *
 * Styles:
 *   - POSSESSION_HIGH_PRESS: high scoring, low conceding, low CS rate (e.g. Manchester City)
 *   - COUNTER_ATTACK: moderate scoring, low conceding, high CS rate (e.g. Atletico Madrid)
 *   - DIRECT_LONG_BALL: variable scoring, variable conceding, high blowout rate
 *   - SET_PIECE_HEAVY: consistent scoring (1-goal wins), tight defense, high CS rate
 *   - HIGH_OCTANE: high scoring AND high conceding, low CS rate (open games)
 *   - DEFENSIVE_BLOC: low scoring, high CS rate, high failedToScore rate
 *   - BALANCED: everything near league average
 *
 * Matchup clashes: possession vs counter → fewer goals (counter nullifies possession).
 * Open vs open → more goals. Defensive vs defensive → far fewer goals.
 *
 * References:
 *   Reep & Benjamin (1968) "Skill and Chance in Association Football". JRSS-A 131(4).
 *   Caley (2015) "Tactical style clusters in Premier League 2014-15". StatsBomb.
 *   Fernandez-Navarro et al. (2018) "Attacking and defensive playing styles in soccer".
 */

import type { PastMatch } from "./weighted-form";

export type TacticalStyle =
  | "POSSESSION_HIGH_PRESS"
  | "COUNTER_ATTACK"
  | "DIRECT_LONG_BALL"
  | "SET_PIECE_HEAVY"
  | "HIGH_OCTANE"
  | "DEFENSIVE_BLOC"
  | "BALANCED";

export interface TacticalProfile {
  style: TacticalStyle;
  styleLabel: string;
  /** Estimated corner/set-piece index (0–1): higher = more set-piece reliant */
  setPieceIndex: number;
  /** Estimated press intensity (0–1) */
  pressIntensity: number;
  /** Attack openness (0–1) */
  attackOpenness: number;
  scoringRate: number;
  concedingRate: number;
  cleanSheetRate: number;
  blowoutRate: number;
}

export interface TacticalMatchup {
  homeStyle: TacticalStyle;
  awayStyle: TacticalStyle;
  matchupLabel: string;
  /** Lambda adjustment for the matchup (both teams) */
  lambdaHomeAdj: number;
  lambdaAwayAdj: number;
  /** Whether a defensive clash is expected */
  isDefensiveClash: boolean;
  /** Whether a high-scoring game is expected */
  isHighScoringExpected: boolean;
  /** Set-piece importance in this matchup (0–1) */
  setPieceImportance: number;
}

const LEAGUE_AVG = 1.35;
const BLOWOUT_THRESHOLD = 4; // total goals in a game

function computeRate(matches: PastMatch[], fn: (m: PastMatch) => number): number {
  if (matches.length === 0) return 0;
  return matches.reduce((s, m) => s + fn(m), 0) / matches.length;
}

function computeVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

export function classifyTacticalStyle(history: PastMatch[]): TacticalProfile {
  const recent = history.slice(0, 10);
  if (recent.length < 3) {
    return {
      style: "BALANCED",
      styleLabel: "Equilibrado",
      setPieceIndex: 0.5,
      pressIntensity: 0.5,
      attackOpenness: 0.5,
      scoringRate: LEAGUE_AVG,
      concedingRate: LEAGUE_AVG,
      cleanSheetRate: 0.3,
      blowoutRate: 0.25,
    };
  }

  const scoringRate = computeRate(recent, (m) => m.goalsFor);
  const concedingRate = computeRate(recent, (m) => m.goalsAgainst);
  const cleanSheetRate = computeRate(recent, (m) => m.goalsAgainst === 0 ? 1 : 0);
  const failedToScoreRate = computeRate(recent, (m) => m.goalsFor === 0 ? 1 : 0);
  const blowoutRate = computeRate(recent, (m) => (m.goalsFor + m.goalsAgainst) >= BLOWOUT_THRESHOLD ? 1 : 0);
  const goalsForValues = recent.map((m) => m.goalsFor);
  const scoringVariance = computeVariance(goalsForValues);
  const scoringCV = scoringRate > 0.01 ? Math.sqrt(scoringVariance) / scoringRate : 1;

  // Classify
  let style: TacticalStyle;
  let styleLabel: string;

  const isHighScorer = scoringRate >= LEAGUE_AVG * 1.3; // > 1.75
  const isLowScorer = scoringRate < LEAGUE_AVG * 0.75; // < 1.01
  const isCleanSheetFocused = cleanSheetRate >= 0.45;
  const isLowConceding = concedingRate < LEAGUE_AVG * 0.80;
  const isHighConceding = concedingRate >= LEAGUE_AVG * 1.30;
  const isBlowoutProne = blowoutRate >= 0.45;
  const isNarrowWinFocused = cleanSheetRate >= 0.35 && failedToScoreRate >= 0.25;

  if (isHighScorer && isLowConceding && !isCleanSheetFocused) {
    style = "POSSESSION_HIGH_PRESS";
    styleLabel = "Posse / Alta Pressão";
  } else if (isCleanSheetFocused && isLowConceding && !isHighScorer) {
    style = "COUNTER_ATTACK";
    styleLabel = "Contra-Ataque";
  } else if (isHighScorer && isHighConceding && isBlowoutProne) {
    style = "HIGH_OCTANE";
    styleLabel = "Alta Octanagem";
  } else if (isNarrowWinFocused && scoringCV < 0.8) {
    style = "SET_PIECE_HEAVY";
    styleLabel = "Bola Parada / Minimalista";
  } else if (isLowScorer && cleanSheetRate >= 0.40) {
    style = "DEFENSIVE_BLOC";
    styleLabel = "Bloco Defensivo";
  } else if (isBlowoutProne && scoringVariance > 1.5) {
    style = "DIRECT_LONG_BALL";
    styleLabel = "Jogo Direto / Longas Bolas";
  } else {
    style = "BALANCED";
    styleLabel = "Equilibrado";
  }

  // Derived indices
  const setPieceIndex = Math.max(0, Math.min(1,
    (cleanSheetRate * 0.4) + ((1 - scoringCV) * 0.3) + ((1 - scoringRate / (LEAGUE_AVG * 2)) * 0.3),
  ));
  const pressIntensity = Math.max(0, Math.min(1,
    (scoringRate / (LEAGUE_AVG * 2)) * 0.5 + (isHighConceding ? 0.3 : 0.1) + (blowoutRate * 0.2),
  ));
  const attackOpenness = Math.max(0, Math.min(1,
    (scoringRate / (LEAGUE_AVG * 2)) * 0.4 + (blowoutRate * 0.4) + ((1 - cleanSheetRate) * 0.2),
  ));

  return {
    style,
    styleLabel,
    setPieceIndex,
    pressIntensity,
    attackOpenness,
    scoringRate,
    concedingRate,
    cleanSheetRate,
    blowoutRate,
  };
}

// ── Matchup analysis ──────────────────────────────────────────────────────────

const STYLE_LAMBDA_ADJ: Record<TacticalStyle, { atk: number; def: number }> = {
  POSSESSION_HIGH_PRESS: { atk: 1.08, def: 0.94 },
  COUNTER_ATTACK:        { atk: 0.96, def: 0.92 },
  HIGH_OCTANE:           { atk: 1.12, def: 1.10 },
  SET_PIECE_HEAVY:       { atk: 0.96, def: 0.91 },
  DEFENSIVE_BLOC:        { atk: 0.90, def: 0.85 },
  DIRECT_LONG_BALL:      { atk: 1.04, def: 1.06 },
  BALANCED:              { atk: 1.00, def: 1.00 },
};

/**
 * Analyzes the tactical matchup between two teams and returns combined adjustments.
 */
export function analyzeTacticalMatchup(
  home: TacticalProfile,
  away: TacticalProfile,
): TacticalMatchup {
  const homeAdj = STYLE_LAMBDA_ADJ[home.style];
  const awayAdj = STYLE_LAMBDA_ADJ[away.style];

  // Home attack is countered by away defense style
  // Away attack is countered by home defense style
  let lambdaHomeAdj = homeAdj.atk * awayAdj.def;
  let lambdaAwayAdj = awayAdj.atk * homeAdj.def;

  // Clash-specific overrides
  const isDefensiveClash =
    (home.style === "COUNTER_ATTACK" || home.style === "DEFENSIVE_BLOC") &&
    (away.style === "COUNTER_ATTACK" || away.style === "DEFENSIVE_BLOC");

  const isBothHighOctane =
    (home.style === "HIGH_OCTANE" || home.style === "POSSESSION_HIGH_PRESS") &&
    (away.style === "HIGH_OCTANE" || away.style === "POSSESSION_HIGH_PRESS");

  const isHighScoringExpected = isBothHighOctane || (home.blowoutRate + away.blowoutRate) / 2 >= 0.45;

  if (isDefensiveClash) {
    // Double defensive → even fewer goals
    lambdaHomeAdj *= 0.90;
    lambdaAwayAdj *= 0.90;
  } else if (isBothHighOctane) {
    lambdaHomeAdj *= 1.08;
    lambdaAwayAdj *= 1.08;
  }

  // Possession vs counter: counter nullifies possession → reduce both lambdas slightly
  const isPossVsCounter =
    (home.style === "POSSESSION_HIGH_PRESS" && away.style === "COUNTER_ATTACK") ||
    (away.style === "POSSESSION_HIGH_PRESS" && home.style === "COUNTER_ATTACK");
  if (isPossVsCounter) {
    lambdaHomeAdj *= 0.95;
    lambdaAwayAdj *= 0.95;
  }

  // Cap adjustments
  lambdaHomeAdj = Math.max(0.80, Math.min(1.20, lambdaHomeAdj));
  lambdaAwayAdj = Math.max(0.80, Math.min(1.20, lambdaAwayAdj));

  const setPieceImportance = (home.setPieceIndex + away.setPieceIndex) / 2;

  let matchupLabel: string;
  if (isDefensiveClash) {
    matchupLabel = `Choque defensivo (${home.styleLabel} vs ${away.styleLabel}) — poucos gols esperados`;
  } else if (isBothHighOctane) {
    matchupLabel = `Jogo aberto (${home.styleLabel} vs ${away.styleLabel}) — muitos gols esperados`;
  } else if (isPossVsCounter) {
    matchupLabel = `Posse vs Contra-ataque — ${away.style === "COUNTER_ATTACK" ? away.styleLabel : home.styleLabel} pode neutralizar`;
  } else {
    matchupLabel = `${home.styleLabel} (casa) vs ${away.styleLabel} (fora) — perfis distintos`;
  }

  return {
    homeStyle: home.style,
    awayStyle: away.style,
    matchupLabel,
    lambdaHomeAdj,
    lambdaAwayAdj,
    isDefensiveClash,
    isHighScoringExpected,
    setPieceImportance,
  };
}
