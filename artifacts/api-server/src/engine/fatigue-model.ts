/**
 * Fatigue, Rotation & Physical Condition Model
 *
 * Methods implemented:
 * M37 — Schedule Fatigue (days rest + match density penalty)
 * M38 — Travel Impact (away distance → fatigue multiplier)
 * M39 — Altitude Adjustment (South American matches)
 * M40 — Rotation Probability (squad depth + fixture congestion → lineup changes)
 *
 * References:
 *   Drust et al (2012) "The effects of fixture congestion on performance in elite soccer"
 *   Carling et al (2016) "Match-to-match variability in high-speed running activity"
 *   Gonzalez-Alonso (2010) "Heat stress, dehydration and muscle fatigue in football"
 */

export interface FatigueInput {
  /** Days since last match (home team) */
  homeDaysRest: number;
  /** Days since last match (away team) */
  awayDaysRest: number;
  /** Number of matches played in last 21 days (home) */
  homeMatchesLast21Days: number;
  /** Number of matches played in last 21 days (away) */
  awayMatchesLast21Days: number;
  /** Is home team playing their 3rd match in 7 days? */
  homeThirdIn7Days?: boolean;
  awayThirdIn7Days?: boolean;
  /** Estimated travel distance for away team (km) */
  awayTravelDistanceKm?: number;
  /** Altitude of venue (meters above sea level) */
  venueAltitudeM?: number;
  /** Is this a cup/secondary competition (lower priority → rotation) */
  isSecondaryCompetition?: boolean;
  /** Squad depth rating (0=thin, 1=average, 2=deep) */
  homeSquadDepth?: number;
  awaySquadDepth?: number;
  /** Current competition importance (0-10) */
  homeCompetitionImportance?: number;
  awayCompetitionImportance?: number;
}

export interface FatigueResult {
  /** Lambda multipliers (apply to base lambda) */
  homeFatigueMultiplier: number;
  awayFatigueMultiplier: number;
  /** Breakdown by component */
  homeRestPenalty: number;
  awayRestPenalty: number;
  homeDensityPenalty: number;
  awayDensityPenalty: number;
  awayTravelPenalty: number;
  altitudePenalty: number;
  /** Rotation risk (0-1: probability of significant lineup changes) */
  homeRotationRisk: number;
  awayRotationRisk: number;
  /** Overall fatigue rating (0=none, 1=severe) */
  homeFatigueIndex: number;
  awayFatigueIndex: number;
  /** Explanation strings */
  alerts: string[];
}

/** Days rest → performance multiplier (recovery curve)
 *  Based on Drust et al (2012): optimal = 5+ days, severe = <3 days
 */
function daysRestMultiplier(days: number): number {
  if (days >= 7) return 1.00;    // fully recovered
  if (days >= 5) return 0.98;    // minimal fatigue
  if (days >= 4) return 0.95;    // slight fatigue
  if (days >= 3) return 0.90;    // moderate fatigue
  if (days >= 2) return 0.83;    // significant fatigue
  return 0.75;                   // severe fatigue (≤1 day)
}

/** Match density → performance penalty */
function densityPenalty(matchesIn21Days: number, isThirdIn7: boolean): number {
  let penalty = 0;
  if (matchesIn21Days >= 8) penalty += 0.08;
  else if (matchesIn21Days >= 6) penalty += 0.05;
  else if (matchesIn21Days >= 5) penalty += 0.03;
  if (isThirdIn7) penalty += 0.06;
  return penalty;
}

/** Travel distance → away team fatigue penalty */
function travelPenalty(distanceKm: number): number {
  if (distanceKm <= 300) return 0.00;
  if (distanceKm <= 800) return 0.02;
  if (distanceKm <= 2000) return 0.04;
  if (distanceKm <= 5000) return 0.07;
  if (distanceKm <= 10000) return 0.10;
  return 0.13; // intercontinental
}

/** Altitude penalty for visiting team (not adapted)
 *  FIFA: 2500m threshold for significant impact
 *  La Paz 3600m, Quito 2800m, Bogotá 2600m, Cusco 3400m
 */
function altitudeLambdaMultiplier(altitudeM: number, isHomeTeam: boolean): number {
  if (altitudeM < 1500) return 1.00;
  if (isHomeTeam) {
    // Home team adapted → slight benefit from home altitude (locals adapted)
    if (altitudeM >= 2500) return 1.04;
    return 1.02;
  }
  // Away team not adapted
  if (altitudeM >= 3500) return 0.74; // La Paz effect
  if (altitudeM >= 2800) return 0.82; // Quito/Bogotá
  if (altitudeM >= 2000) return 0.90; // Moderate altitude
  return 0.96;
}

/** Rotation probability (probability of significant lineup changes) */
function rotationRisk(
  daysRest: number,
  matchesIn21Days: number,
  isSecondary: boolean,
  squadDepth: number,
  importance: number,
): number {
  let risk = 0;
  // Low importance + deep squad = high rotation
  if (isSecondary && importance < 5) risk += 0.35;
  if (isSecondary && importance < 3) risk += 0.20;
  if (squadDepth >= 2 && matchesIn21Days >= 6) risk += 0.25;
  if (daysRest >= 5 && isSecondary) risk += 0.15;
  if (matchesIn21Days >= 8) risk += 0.20;
  return Math.min(0.90, risk);
}

export function computeFatigue(input: FatigueInput): FatigueResult {
  const {
    homeDaysRest,
    awayDaysRest,
    homeMatchesLast21Days,
    awayMatchesLast21Days,
    homeThirdIn7Days = false,
    awayThirdIn7Days = false,
    awayTravelDistanceKm = 500,
    venueAltitudeM = 50,
    isSecondaryCompetition = false,
    homeSquadDepth = 1,
    awaySquadDepth = 1,
    homeCompetitionImportance = 7,
    awayCompetitionImportance = 7,
  } = input;

  // Rest multipliers
  const homeRestMult = daysRestMultiplier(homeDaysRest);
  const awayRestMult = daysRestMultiplier(awayDaysRest);
  const homeRestPenalty = 1 - homeRestMult;
  const awayRestPenalty = 1 - awayRestMult;

  // Density penalties
  const homeDensity = densityPenalty(homeMatchesLast21Days, homeThirdIn7Days);
  const awayDensity = densityPenalty(awayMatchesLast21Days, awayThirdIn7Days);

  // Travel penalty (away only)
  const awayTravel = travelPenalty(awayTravelDistanceKm);

  // Altitude
  const homeAltMult = altitudeLambdaMultiplier(venueAltitudeM, true);
  const awayAltMult = altitudeLambdaMultiplier(venueAltitudeM, false);
  const altitudePenalty = 1 - awayAltMult;

  // Combined multipliers
  const homeFatigueMultiplier = Math.max(
    0.55,
    homeRestMult * (1 - homeDensity) * homeAltMult,
  );
  const awayFatigueMultiplier = Math.max(
    0.50,
    awayRestMult * (1 - awayDensity) * (1 - awayTravel) * awayAltMult,
  );

  // Fatigue indices (0=none, 1=severe)
  const homeFatigueIndex = 1 - homeFatigueMultiplier;
  const awayFatigueIndex = 1 - awayFatigueMultiplier;

  // Rotation risks
  const homeRotationRisk = rotationRisk(
    homeDaysRest, homeMatchesLast21Days, isSecondaryCompetition,
    homeSquadDepth, homeCompetitionImportance,
  );
  const awayRotationRisk = rotationRisk(
    awayDaysRest, awayMatchesLast21Days, isSecondaryCompetition,
    awaySquadDepth, awayCompetitionImportance,
  );

  // Alert messages
  const alerts: string[] = [];
  if (homeDaysRest < 3) alerts.push(`Mandante com apenas ${homeDaysRest}d de descanso — fadiga severa`);
  if (awayDaysRest < 3) alerts.push(`Visitante com apenas ${awayDaysRest}d de descanso — fadiga severa`);
  if (homeThirdIn7Days) alerts.push("Mandante joga 3º em 7 dias — desgaste crítico");
  if (awayThirdIn7Days) alerts.push("Visitante joga 3º em 7 dias — desgaste crítico");
  if (venueAltitudeM >= 2800) alerts.push(`Altitude extrema: ${venueAltitudeM}m — visitante penalizado ${Math.round(altitudePenalty * 100)}%`);
  if (awayTravelDistanceKm >= 5000) alerts.push(`Viagem longa: ${Math.round(awayTravelDistanceKm)}km — fadiga de viagem`);
  if (homeRotationRisk > 0.5) alerts.push(`Risco alto de rotação no elenco mandante (${Math.round(homeRotationRisk * 100)}%)`);
  if (awayRotationRisk > 0.5) alerts.push(`Risco alto de rotação no elenco visitante (${Math.round(awayRotationRisk * 100)}%)`);

  return {
    homeFatigueMultiplier,
    awayFatigueMultiplier,
    homeRestPenalty,
    awayRestPenalty,
    homeDensityPenalty: homeDensity,
    awayDensityPenalty: awayDensity,
    awayTravelPenalty: awayTravel,
    altitudePenalty,
    homeRotationRisk,
    awayRotationRisk,
    homeFatigueIndex,
    awayFatigueIndex,
    alerts,
  };
}
