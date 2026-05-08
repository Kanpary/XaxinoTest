/**
 * Pressing, Possession & Tactical Pressure Model
 *
 * Methods implemented:
 * M71 — PPDA Pressing Index (passes allowed per defensive action → lambda adj)
 * M72 — Possession Dominance Model (possession % → control vs chaos tradeoff)
 * M73 — Asymmetric Matchup Resolver (pressing vs block / counter vs possession)
 * M74 — Variance Inflation Index (high-chaos matchups → wider score distribution)
 * M75 — Expected Corners Model (attack style + field position → corner rate)
 *
 * References:
 *   Mackay (2017) "The PPDA: Pressing Intensity in Football"
 *   Fernandez et al (2021) "Decomposing the Immeasurable Sport"
 *   Groll et al (2018) "Prediction of major international soccer tournaments based on team-specific regularized regression"
 */

export interface PressingInput {
  /** PPDA = passes allowed per defensive action in opponent half
   *  Lower = higher pressing intensity
   *  Elite pressing (Klopp/Guardiola): 4-7
   *  Average: 9-12
   *  Low block: 15+
   */
  homePPDA?: number;
  awayPPDA?: number;
  /** Possession % (0-100) */
  homePossession?: number;
  awayPossession?: number;
  /** High defensive line (true = high line = more vulnerable to counters) */
  homeHighLine?: boolean;
  awayHighLine?: boolean;
  /** Average field position (0-100: 50=half, higher=more advanced) */
  homeFieldPosition?: number;
  awayFieldPosition?: number;
  /** Corners won per match */
  homeCornersPerMatch?: number;
  awayCornersPerMatch?: number;
  /** Base lambdas from ensemble */
  baseLambdaHome: number;
  baseLambdaAway: number;
}

export interface PressingResult {
  /** Adjusted lambdas after tactical analysis */
  adjustedLambdaHome: number;
  adjustedLambdaAway: number;
  /** Pressing indices (0=low block, 1=elite pressing) */
  homePressIndex: number;
  awayPressIndex: number;
  /** Possession dominance score (-1=away dominated, +1=home dominated) */
  possessionDominance: number;
  /** Tactical matchup type */
  matchupType: string;
  /** Variance inflation (>1 = wider distribution expected) */
  varianceInflation: number;
  /** Expected corners per match */
  expectedCornersHome: number;
  expectedCornersAway: number;
  /** Chaos index (0=ordered/predictable, 1=chaotic/volatile) */
  chaosIndex: number;
  /** Tactical notes */
  tacticalNotes: string[];
}

/** Convert PPDA to pressing index (0-1) */
function ppda_to_index(ppda: number): number {
  // PPDA 4 → index 1.0 (elite), PPDA 20 → index 0.0
  return Math.max(0, Math.min(1, (20 - ppda) / 16));
}

/** Possession to lambda adjustment
 *  High possession team: more controlled → less variance but consistent output
 *  Low possession team: may rely on counters → spiky goal pattern
 */
function possessionLambdaMultiplier(ownPoss: number, oppPoss: number): number {
  // Possession < 40%: team forced to absorb → may score fewer but efficiently
  // Possession > 60%: more chances but opponent compact defense
  const balance = (ownPoss - 50) / 50; // -1 to +1
  // Diminishing returns: extreme possession doesn't linearly improve scoring
  return 1.0 + balance * 0.08;
}

/** High line + PPDA analysis: aggressive press + high line = volatile */
function tacticalVolatility(
  pressingIndex: number,
  highLine: boolean,
  fieldPosition: number,
): number {
  let volatility = 0.5;
  if (pressingIndex > 0.6 && highLine) volatility += 0.3; // aggressive + exposed
  if (pressingIndex < 0.2 && !highLine) volatility -= 0.2; // deep block = low
  volatility += (fieldPosition - 50) / 100; // advanced position = more volatile
  return Math.max(0, Math.min(1, volatility));
}

/** Expected corners from field position and attack style */
function expectedCorners(fieldPosition: number, possession: number, cornersBase: number): number {
  const positionBonus = (fieldPosition - 50) / 100;
  const pressureBonus = (possession - 50) / 200;
  return Math.max(0.5, cornersBase * (1 + positionBonus + pressureBonus));
}

/** Tactical matchup classification */
function classifyMatchup(
  homePressIdx: number,
  awayPressIdx: number,
  homePoss: number,
  awayPoss: number,
): { type: string; lambdaHomeMult: number; lambdaAwayMult: number; varianceBoost: number } {
  const homeHighPress = homePressIdx > 0.55;
  const awayHighPress = awayPressIdx > 0.55;
  const homeHighPoss = homePoss > 55;
  const awayHighPoss = awayPoss > 55;

  if (homeHighPress && awayHighPress) {
    return { type: "Alta Intensidade vs Alta Intensidade", lambdaHomeMult: 1.12, lambdaAwayMult: 1.12, varianceBoost: 0.3 };
  }
  if (homeHighPress && !awayHighPress && awayHighPoss) {
    return { type: "Pressing vs Posse (home ataca espaços)", lambdaHomeMult: 1.08, lambdaAwayMult: 0.92, varianceBoost: 0.2 };
  }
  if (!homeHighPress && awayHighPress && homeHighPoss) {
    return { type: "Posse vs Pressing (visitante ataca espaços)", lambdaHomeMult: 0.92, lambdaAwayMult: 1.08, varianceBoost: 0.2 };
  }
  if (homeHighPoss && awayHighPoss) {
    return { type: "Posse vs Posse (intensidade baixa)", lambdaHomeMult: 0.95, lambdaAwayMult: 0.95, varianceBoost: -0.1 };
  }
  if (!homeHighPress && !awayHighPress) {
    return { type: "Bloco Baixo vs Bloco Baixo (poucas chances)", lambdaHomeMult: 0.88, lambdaAwayMult: 0.88, varianceBoost: -0.2 };
  }
  if (homeHighPress && !awayHighPoss) {
    return { type: "Pressing vs Contra-ataque", lambdaHomeMult: 1.05, lambdaAwayMult: 1.05, varianceBoost: 0.15 };
  }
  return { type: "Equilíbrio tático", lambdaHomeMult: 1.0, lambdaAwayMult: 1.0, varianceBoost: 0.0 };
}

export function computePressing(input: PressingInput): PressingResult {
  const {
    homePPDA = 10,
    awayPPDA = 10,
    homePossession = 50,
    awayPossession = 50,
    homeHighLine = false,
    awayHighLine = false,
    homeFieldPosition = 50,
    awayFieldPosition = 50,
    homeCornersPerMatch = 5,
    awayCornersPerMatch = 4,
    baseLambdaHome,
    baseLambdaAway,
  } = input;

  // Pressing indices
  const homePressIndex = ppda_to_index(homePPDA);
  const awayPressIndex = ppda_to_index(awayPPDA);

  // Possession adjustment
  const homePossAdj = possessionLambdaMultiplier(homePossession, awayPossession);
  const awayPossAdj = possessionLambdaMultiplier(awayPossession, homePossession);

  // Tactical matchup
  const matchup = classifyMatchup(homePressIndex, awayPressIndex, homePossession, awayPossession);

  // Tactical volatility (chaos)
  const homeVolatility = tacticalVolatility(homePressIndex, homeHighLine, homeFieldPosition);
  const awayVolatility = tacticalVolatility(awayPressIndex, awayHighLine, awayFieldPosition);
  const chaosIndex = (homeVolatility + awayVolatility) / 2;

  // Variance inflation
  const varianceInflation = Math.max(0.8, 1.0 + matchup.varianceBoost + chaosIndex * 0.3);

  // Adjusted lambdas
  const adjustedLambdaHome = Math.max(
    0.1,
    baseLambdaHome * matchup.lambdaHomeMult * homePossAdj,
  );
  const adjustedLambdaAway = Math.max(
    0.1,
    baseLambdaAway * matchup.lambdaAwayMult * awayPossAdj,
  );

  // Possession dominance
  const possessionDominance = (homePossession - awayPossession) / 100;

  // Expected corners
  const expCornersHome = expectedCorners(homeFieldPosition, homePossession, homeCornersPerMatch);
  const expCornersAway = expectedCorners(awayFieldPosition, awayPossession, awayCornersPerMatch);

  // Tactical notes
  const tacticalNotes: string[] = [];
  if (homePressIndex > 0.65) tacticalNotes.push(`Pressing alto mandante (PPDA ${homePPDA.toFixed(1)})`);
  if (awayPressIndex > 0.65) tacticalNotes.push(`Pressing alto visitante (PPDA ${awayPPDA.toFixed(1)})`);
  if (homePossession > 60) tacticalNotes.push(`Domínio de posse mandante (${homePossession.toFixed(0)}%)`);
  if (awayPossession > 60) tacticalNotes.push(`Domínio de posse visitante (${awayPossession.toFixed(0)}%)`);
  if (homeHighLine && awayPressIndex > 0.5) tacticalNotes.push("Linha alta mandante exposta ao pressing visitante");
  if (chaosIndex > 0.65) tacticalNotes.push("Jogo caótico esperado — alta variância no placar");
  if (varianceInflation > 1.3) tacticalNotes.push("Distribuição de placar mais dispersa");
  tacticalNotes.push(matchup.type);

  return {
    adjustedLambdaHome,
    adjustedLambdaAway,
    homePressIndex,
    awayPressIndex,
    possessionDominance,
    matchupType: matchup.type,
    varianceInflation,
    expectedCornersHome: expCornersHome,
    expectedCornersAway: expCornersAway,
    chaosIndex,
    tacticalNotes,
  };
}
