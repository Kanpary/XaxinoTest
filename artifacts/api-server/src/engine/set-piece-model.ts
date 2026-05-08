/**
 * Set Piece Model — Corners, Free Kicks, Penalties
 *
 * Methods implemented:
 * M41 — Set Piece Goal Contribution (corners + FKs + penalties → ΔλSP)
 * M42 — Referee Tendency Model (card rate → game disruption → scoring adjustment)
 * M43 — Weather & Pitch Impact (precipitation, wind, temperature → scoring adjustment)
 *
 * References:
 *   Caley (2013) "Putting Set Pieces in Context"
 *   Pollard & Reep (1997) "Measuring the effectiveness of playing strategies"
 *   Andersson et al (2004) "Referee decisions in football"
 */

export interface SetPieceInput {
  /** Corners won per match (home attacking) */
  homeCornersPerMatch: number;
  /** Corners won per match (away attacking) */
  awayCornersPerMatch: number;
  /** Free kicks in dangerous areas per match */
  homeDangerousFKsPerMatch?: number;
  awayDangerousFKsPerMatch?: number;
  /** Penalty conversion rate (default 0.76) */
  homePenaltyRate?: number;
  awayPenaltyRate?: number;
  /** Set piece threat rating (0=poor, 1=average, 2=elite aerial) */
  homeSetPieceThreat?: number;
  awaySetPieceThreat?: number;
  /** Set piece vulnerability (defending) */
  homeSetPieceVulnerability?: number;
  awaySetPieceVulnerability?: number;
  /** Referee context */
  refereeCardsPerMatch?: number;
  refereePenaltiesPerMatch?: number;
  /** Weather conditions */
  precipitationMm?: number;  // mm/h rain
  windSpeedKmh?: number;
  temperatureC?: number;
  /** Pitch quality (0=poor, 1=average, 2=perfect) */
  pitchQuality?: number;
}

export interface SetPieceResult {
  /** Additional goals from set pieces (to add to base lambda) */
  deltaLambdaHome: number;
  deltaLambdaAway: number;
  /** Breakdown */
  homeCornerGoals: number;
  awayCornerGoals: number;
  homeFKGoals: number;
  awayFKGoals: number;
  homePenaltyGoals: number;
  awayPenaltyGoals: number;
  /** Weather multiplier (apply to total lambda) */
  weatherMultiplier: number;
  weatherDescription: string;
  /** Referee impact */
  refereeDisruptionFactor: number;
  cardExpectedCount: number;
  penaltyExpectedCount: number;
  /** Set piece dominance rating */
  homeSetPieceDominance: number;
  awaySetPieceDominance: number;
}

/** Corner conversion rate to goals
 *  Empirically: ~2.7% of corners result in a goal (all football leagues average)
 *  Threat rating adjusts: poor=1.5%, average=2.7%, elite=4.2%
 */
function cornerGoalRate(threatRating: number, opponentVulnerability: number): number {
  const baseCvr = 0.027;
  const threatMult = 0.6 + 0.4 * threatRating; // 0.6–1.4
  const vulnerMult = 0.8 + 0.4 * opponentVulnerability; // 0.8–1.6
  return baseCvr * threatMult * vulnerMult;
}

/** Free kick danger area goal rate (~5.5% average) */
function fkGoalRate(threatRating: number): number {
  return 0.055 * (0.7 + 0.3 * threatRating);
}

/** Weather multiplier for goal scoring */
function weatherGoalMultiplier(
  precipMm: number,
  windKmh: number,
  tempC: number,
  pitchQuality: number,
): { multiplier: number; description: string } {
  let multiplier = 1.0;
  const notes: string[] = [];

  // Heavy rain reduces passing accuracy and increases errors
  if (precipMm > 10) {
    multiplier *= 0.87;
    notes.push("chuva forte");
  } else if (precipMm > 3) {
    multiplier *= 0.94;
    notes.push("chuva moderada");
  }

  // Strong wind disrupts long passes and aerial balls
  if (windKmh > 50) {
    multiplier *= 0.83;
    notes.push("vento forte");
  } else if (windKmh > 30) {
    multiplier *= 0.92;
    notes.push("vento moderado");
  }

  // Extreme cold reduces player mobility and ball movement
  if (tempC < -5) {
    multiplier *= 0.88;
    notes.push("frio extremo");
  } else if (tempC < 5) {
    multiplier *= 0.94;
    notes.push("frio");
  }

  // Extreme heat (>35°C) also reduces performance
  if (tempC > 35) {
    multiplier *= 0.91;
    notes.push("calor extremo");
  }

  // Poor pitch → more chaotic, less technical → slightly more or less goals
  if (pitchQuality < 0.5) {
    multiplier *= 0.93;
    notes.push("campo ruim");
  }

  const description = notes.length > 0 ? notes.join(", ") : "condições ideais";
  return { multiplier, description };
}

/** Referee disruption model
 *  High card rate → more game stoppages → lower scoring rhythm
 *  High penalty rate → adds goals directly
 */
function refereeImpact(
  cardsPerMatch: number,
  penaltiesPerMatch: number,
): { disruptionFactor: number; cardExpected: number; penaltyExpected: number } {
  // Average refs: ~4 yellow cards/match, ~0.25 penalties/match
  const normalCards = 4.0;
  const normalPenalties = 0.25;

  // High card rate → disruption → lower scoring (by max 8%)
  const cardRatio = cardsPerMatch / normalCards;
  const disruptionFactor = Math.max(0.92, 1 - (cardRatio - 1) * 0.05);

  // Penalty contribution: each penalty has ~76% chance of goal
  const penaltyGoalContrib = penaltiesPerMatch * 0.76;

  return {
    disruptionFactor,
    cardExpected: cardsPerMatch,
    penaltyExpected: penaltiesPerMatch,
  };
}

export function computeSetPiece(input: SetPieceInput): SetPieceResult {
  const {
    homeCornersPerMatch,
    awayCornersPerMatch,
    homeDangerousFKsPerMatch = homeCornersPerMatch * 0.4,
    awayDangerousFKsPerMatch = awayCornersPerMatch * 0.4,
    homePenaltyRate = 0.76,
    awayPenaltyRate = 0.76,
    homeSetPieceThreat = 1,
    awaySetPieceThreat = 1,
    homeSetPieceVulnerability = 1,
    awaySetPieceVulnerability = 1,
    refereeCardsPerMatch = 4.0,
    refereePenaltiesPerMatch = 0.25,
    precipitationMm = 0,
    windSpeedKmh = 0,
    temperatureC = 18,
    pitchQuality = 1,
  } = input;

  // Corner goals
  const homeCornerRate = cornerGoalRate(homeSetPieceThreat, awaySetPieceVulnerability);
  const awayCornerRate = cornerGoalRate(awaySetPieceThreat, homeSetPieceVulnerability);
  const homeCornerGoals = homeCornersPerMatch * homeCornerRate;
  const awayCornerGoals = awayCornersPerMatch * awayCornerRate;

  // Free kick goals
  const homeFKGoals = homeDangerousFKsPerMatch * fkGoalRate(homeSetPieceThreat);
  const awayFKGoals = awayDangerousFKsPerMatch * fkGoalRate(awaySetPieceThreat);

  // Penalty goals (expected penalties × conversion rate)
  const penPerMatch = refereePenaltiesPerMatch;
  const homePenaltyGoals = penPerMatch * 0.5 * homePenaltyRate; // ~50% for each team
  const awayPenaltyGoals = penPerMatch * 0.5 * awayPenaltyRate;

  // Total set piece delta lambda
  const deltaLambdaHome = homeCornerGoals + homeFKGoals + homePenaltyGoals;
  const deltaLambdaAway = awayCornerGoals + awayFKGoals + awayPenaltyGoals;

  // Weather impact
  const weather = weatherGoalMultiplier(precipitationMm, windSpeedKmh, temperatureC, pitchQuality);

  // Referee impact
  const ref = refereeImpact(refereeCardsPerMatch, refereePenaltiesPerMatch);

  // Set piece dominance (how much SP contributes to team's total scoring)
  const homeSetPieceDominance = Math.min(1, deltaLambdaHome / 0.4);
  const awaySetPieceDominance = Math.min(1, deltaLambdaAway / 0.4);

  return {
    deltaLambdaHome,
    deltaLambdaAway,
    homeCornerGoals,
    awayCornerGoals,
    homeFKGoals,
    awayFKGoals,
    homePenaltyGoals,
    awayPenaltyGoals,
    weatherMultiplier: weather.multiplier,
    weatherDescription: weather.description,
    refereeDisruptionFactor: ref.disruptionFactor,
    cardExpectedCount: ref.cardExpected,
    penaltyExpectedCount: ref.penaltyExpected,
    homeSetPieceDominance,
    awaySetPieceDominance,
  };
}
