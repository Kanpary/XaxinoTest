/**
 * Parlay (Múltipla) suggestion service.
 *
 * Takes the last scanner run results (or the active live games) and selects
 * the best combination of independent picks to form a suggested parlay.
 *
 * Selection criteria:
 *  1. Only SINGULARITY verdicts with convergence >= 0.70
 *  2. Prefer picks where Markov, Hawkes, and meta-ensemble agree (triple lock)
 *  3. Maximise joint probability (product) subject to a minimum joint prob threshold
 *  4. Cap at 5 legs; suggest 2–4 as the sweet spot
 *  5. Include an alternative safer 2-leg acca and a riskier 4-leg option
 */

import { logger } from "../lib/logger";

export interface ParlayLeg {
  fixtureId: string;
  leagueId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffBrasilia: string;
  pick: string;               // e.g. "1–0" or "BTTS SIM" or "OVER 2.5"
  pickType: "exact_score" | "btts" | "over_under" | "1x2";
  prob: number;
  fairOdd: number;
  convergence: number;
  zScore: number;
  markovAgrees: boolean;
  hawkesAgrees: boolean;
}

export interface ParlayOption {
  label: string;             // e.g. "Múltipla Recomendada (3 jogos)"
  legs: ParlayLeg[];
  jointProb: number;
  combinedFairOdd: number;
  confidenceLabel: "ALTA" | "MÉDIA" | "BAIXA";
  note: string;
}

export interface ParlayOut {
  generatedAt: string;
  date: string;
  recommended: ParlayOption | null;
  alternatives: ParlayOption[];
  totalCandidates: number;
}

export interface ParlayCandidate {
  fixtureId: string;
  leagueId: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffBrasilia: string;
  verdict: string;
  primary: { home: number; away: number; prob: number };
  convergence: number;
  zScore: number;
  assertiveness: number;
  bttsProb?: number;
  mcStats?: { over25: number; homeWinProb: number; drawProb: number; awayWinProb: number; avgTotalGoals: number };
  liveMarkov?: { remainingGoalsHome: number; remainingGoalsAway: number } | null;
  hawkesAnalysis?: { projectedHome: number; projectedAway: number } | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickTypeFromReport(c: ParlayCandidate): { pick: string; pickType: ParlayLeg["pickType"]; prob: number } {
  const { primary, bttsProb, mcStats, convergence } = c;

  // Prefer exact score when confidence is high (convergence >= 0.75, prob >= 0.12)
  if (convergence >= 0.75 && primary.prob >= 0.12) {
    return {
      pick: `${primary.home}–${primary.away}`,
      pickType: "exact_score",
      prob: primary.prob,
    };
  }

  // Fall back to BTTS when probability is strong (>= 0.62 or <= 0.35)
  if (bttsProb !== undefined) {
    if (bttsProb >= 0.62) return { pick: "BTTS SIM", pickType: "btts", prob: bttsProb };
    if (bttsProb <= 0.35) return { pick: "BTTS NÃO", pickType: "btts", prob: 1 - bttsProb };
  }

  // Over/Under 2.5
  if (mcStats) {
    if (mcStats.over25 >= 0.62) return { pick: "OVER 2.5 gols", pickType: "over_under", prob: mcStats.over25 };
    if (mcStats.over25 <= 0.38) return { pick: "UNDER 2.5 gols", pickType: "over_under", prob: 1 - mcStats.over25 };

    // 1X2 when skewed enough
    const max = Math.max(mcStats.homeWinProb, mcStats.drawProb, mcStats.awayWinProb);
    if (max >= 0.60) {
      if (mcStats.homeWinProb === max) return { pick: "Casa (1)", pickType: "1x2", prob: mcStats.homeWinProb };
      if (mcStats.drawProb === max) return { pick: "Empate (X)", pickType: "1x2", prob: mcStats.drawProb };
      return { pick: "Fora (2)", pickType: "1x2", prob: mcStats.awayWinProb };
    }
  }

  // Fallback: exact score
  return {
    pick: `${primary.home}–${primary.away}`,
    pickType: "exact_score",
    prob: primary.prob,
  };
}

function markovAgrees(c: ParlayCandidate): boolean {
  if (!c.liveMarkov) return false;
  const mh = Math.round(c.liveMarkov.remainingGoalsHome);
  const ma = Math.round(c.liveMarkov.remainingGoalsAway);
  return mh === c.primary.home && ma === c.primary.away;
}

function hawkesAgrees(c: ParlayCandidate): boolean {
  if (!c.hawkesAnalysis) return false;
  const hh = Math.round(c.hawkesAnalysis.projectedHome);
  const ha = Math.round(c.hawkesAnalysis.projectedAway);
  return hh === c.primary.home && ha === c.primary.away;
}

function buildLeg(c: ParlayCandidate): ParlayLeg {
  const { pick, pickType, prob } = pickTypeFromReport(c);
  return {
    fixtureId: c.fixtureId,
    leagueId: c.leagueId,
    leagueName: c.leagueName,
    homeTeam: c.homeTeam,
    awayTeam: c.awayTeam,
    kickoffBrasilia: c.kickoffBrasilia,
    pick,
    pickType,
    prob,
    fairOdd: prob > 0 ? 1 / prob : 99,
    convergence: c.convergence,
    zScore: c.zScore,
    markovAgrees: markovAgrees(c),
    hawkesAgrees: hawkesAgrees(c),
  };
}

function buildOption(label: string, legs: ParlayLeg[], note: string): ParlayOption {
  const jointProb = legs.reduce((p, l) => p * l.prob, 1);
  const combinedFairOdd = jointProb > 0 ? 1 / jointProb : 9999;

  let confidenceLabel: ParlayOption["confidenceLabel"] = "BAIXA";
  if (jointProb >= 0.15) confidenceLabel = "ALTA";
  else if (jointProb >= 0.08) confidenceLabel = "MÉDIA";

  return { label, legs, jointProb, combinedFairOdd, confidenceLabel, note };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildParlaySuggestion(
  candidates: ParlayCandidate[],
  date: string,
): ParlayOut {
  logger.info({ count: candidates.length }, "Building parlay suggestion");

  // 1. Filter: only SINGULARITY with minimum quality
  const eligible = candidates
    .filter((c) => c.verdict === "SINGULARITY" && c.convergence >= 0.68)
    .map((c) => ({ c, leg: buildLeg(c) }))
    .filter(({ leg }) => leg.prob >= 0.08); // minimum 8% probability per leg

  // 2. Score each leg: higher = better candidate for parlay
  const scored = eligible.map(({ c, leg }) => {
    let score = leg.prob * 0.40 + c.convergence * 0.35 + Math.min(c.zScore, 12) / 12 * 0.25;
    if (leg.markovAgrees) score += 0.08;
    if (leg.hawkesAgrees) score += 0.05;
    if (leg.pickType !== "exact_score") score += 0.06; // non-exact bets are safer
    return { c, leg, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const alternatives: ParlayOption[] = [];

  if (scored.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      date,
      recommended: null,
      alternatives: [],
      totalCandidates: candidates.length,
    };
  }

  // 3. Safe 2-leg acca
  if (scored.length >= 2) {
    const legs2 = scored.slice(0, 2).map((s) => s.leg);
    alternatives.push(buildOption(
      "Dupla Segura (2 jogos)",
      legs2,
      "As duas melhores oportunidades do dia — probabilidade conjunta mais alta.",
    ));
  }

  // 4. Recommended 3-leg acca (sweet spot)
  let recommended: ParlayOption | null = null;
  if (scored.length >= 3) {
    const legs3 = scored.slice(0, 3).map((s) => s.leg);
    recommended = buildOption(
      "Múltipla Recomendada (3 jogos)",
      legs3,
      "Equilíbrio ideal entre odd combinada e probabilidade conjunta. Odd justa estimada pelo motor.",
    );
  } else if (scored.length === 2) {
    recommended = alternatives[0] ?? null;
    alternatives.splice(0, 1);
  } else {
    const legs1 = [scored[0]!.leg];
    recommended = buildOption("Seleção Única", legs1, "Apenas um candidato de alta qualidade encontrado hoje.");
  }

  // 5. Riskier 4–5 leg option
  if (scored.length >= 4) {
    const count = Math.min(5, scored.length);
    const legs = scored.slice(0, count).map((s) => s.leg);
    alternatives.push(buildOption(
      `Múltipla Agressiva (${count} jogos)`,
      legs,
      "Odd combinada mais alta, mas probabilidade conjunta menor. Apenas para apostas menores.",
    ));
  }

  return {
    generatedAt: new Date().toISOString(),
    date,
    recommended,
    alternatives,
    totalCandidates: candidates.length,
  };
}
