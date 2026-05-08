/**
 * X-RAY Anomaly Flag Detector — OMNI-TITANIUM 7.0
 *
 * Scans recent team histories for statistically significant anomalies that
 * the base Poisson/Elo models cannot fully capture (regime changes, streaks,
 * structural crises, tactical patterns). Each flag carries a multiplicative
 * lambda adjustment applied in scanner.ts before ensemble computation.
 *
 * Core flags (v1):
 *   MURALHA_DEFENSIVA      — 3+ consecutive clean sheets (defensive wall)
 *   CRISE_OFENSIVA         — 3+ consecutive scoreless games (attacking crisis)
 *   COLAPSO_DEFENSIVO      — conceded 2+ goals in each of last 3 games
 *   ALTA_VOLATILIDADE      — both teams avg > 3.8 total goals/game (last 4)
 *   MOMENTUM_OFENSIVO      — scored 2+ in each of last 3 games (hot streak)
 *   FADIGA_CRITICA         — 3+ games in the last 10 days (fixture congestion)
 *
 * Extended flags (v2):
 *   PADRAO_MINIMALISTA     — team's wins dominated by 1-goal margins (1-0 style)
 *   FORCA_DEFENSIVA_SOLIDA — clean sheet rate > 50% in last 6 games
 *   TENDENCIA_BLOWOUT      — 3+ goals scored or conceded in 3+ of last 5 games
 *   ATAQUE_EXPLOSIVO       — scored 3+ in 2+ of last 5 games (high ceiling)
 *   DESEQUILIBRIO_MARCANTE — λH / λA > 2.2 or < 0.45 (massive asymmetry)
 *   FORMA_DIVERGENTE       — one team strongly improving, other strongly declining
 *   INCONSISTENCIA_EXTREMA — goal variance > 2.5 (very erratic scoring)
 */

import type { PastMatch } from "./weighted-form";

export interface XRayFlag {
  code: string;
  label: string;
  severity: "CRITICA" | "ALTA" | "MEDIA";
  team: "home" | "away" | "both";
  /** Multiplicative adjustments applied to scoring lambdas. */
  lambdaAdj: {
    lambdaHome?: number;
    lambdaAway?: number;
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function consecutiveCleanSheets(matches: PastMatch[]): number {
  let n = 0;
  for (const m of matches) {
    if (m.goalsAgainst === 0) n++;
    else break;
  }
  return n;
}

function consecutiveScoringDrought(matches: PastMatch[]): number {
  let n = 0;
  for (const m of matches) {
    if (m.goalsFor === 0) n++;
    else break;
  }
  return n;
}

function consecutiveHighConcede(matches: PastMatch[], threshold: number): number {
  let n = 0;
  for (const m of matches) {
    if (m.goalsAgainst >= threshold) n++;
    else break;
  }
  return n;
}

function consecutiveHighScore(matches: PastMatch[], threshold: number): number {
  let n = 0;
  for (const m of matches) {
    if (m.goalsFor >= threshold) n++;
    else break;
  }
  return n;
}

function avgTotalGoals(matches: PastMatch[]): number {
  if (matches.length === 0) return 0;
  return matches.reduce((s, m) => s + m.goalsFor + m.goalsAgainst, 0) / matches.length;
}

function gamesInLastNDays(matches: PastMatch[], days: number): number {
  return matches.filter((m) => m.daysAgo <= days).length;
}

/** Fraction of matches with 0 goals conceded */
function cleanSheetRate(matches: PastMatch[]): number {
  if (matches.length === 0) return 0;
  return matches.filter((m) => m.goalsAgainst === 0).length / matches.length;
}

/** Count of matches where team scored N or more goals */
function countMatchesWithNPlusGoals(matches: PastMatch[], n: number): number {
  return matches.filter((m) => m.goalsFor >= n).length;
}

/** Count of matches where team conceded N or more goals */
function countMatchesConcedeNPlus(matches: PastMatch[], n: number): number {
  return matches.filter((m) => m.goalsAgainst >= n).length;
}

/** Fraction of wins that were by exactly 1 goal */
function narrowWinRate(matches: PastMatch[]): number {
  const wins = matches.filter((m) => m.goalsFor > m.goalsAgainst);
  if (wins.length < 2) return 0;
  const narrowWins = wins.filter((m) => m.goalsFor - m.goalsAgainst === 1);
  return narrowWins.length / wins.length;
}

/** Variance of goals scored */
function goalsVariance(matches: PastMatch[]): number {
  if (matches.length < 3) return 0;
  const mean = matches.reduce((s, m) => s + m.goalsFor, 0) / matches.length;
  return matches.reduce((s, m) => s + (m.goalsFor - mean) ** 2, 0) / matches.length;
}

/** Weighted linear trend of goals scored (negative slope = improving) */
function formTrendSlope(matches: PastMatch[]): number {
  if (matches.length < 4) return 0;
  const xi = 0.0065;
  let sumW = 0, sumWt = 0, sumWg = 0, sumWt2 = 0, sumWtg = 0;
  for (const m of matches) {
    const w = Math.exp(-xi * Math.max(0, m.daysAgo));
    sumW += w; sumWt += w * m.daysAgo; sumWg += w * m.goalsFor;
    sumWt2 += w * m.daysAgo * m.daysAgo; sumWtg += w * m.daysAgo * m.goalsFor;
  }
  const denom = sumW * sumWt2 - sumWt * sumWt;
  if (Math.abs(denom) < 1e-10) return 0;
  return (sumW * sumWtg - sumWt * sumWg) / denom; // raw slope (goals/day)
}

// ── main detector ─────────────────────────────────────────────────────────────

export function detectXRayFlags(
  homeHistory: PastMatch[],
  awayHistory: PastMatch[],
  homeTeam: string,
  awayTeam: string,
  /** Optional: pre-computed blended lambdas for DESEQUILIBRIO detection */
  blendedLambdas?: { lambdaHome: number; lambdaAway: number },
): XRayFlag[] {
  const flags: XRayFlag[] = [];

  const hR = homeHistory.slice(0, 5); // recent home team form
  const aR = awayHistory.slice(0, 5); // recent away team form
  const hR6 = homeHistory.slice(0, 6);
  const aR6 = awayHistory.slice(0, 6);

  // ── MURALHA_DEFENSIVA ─────────────────────────────────────────────────────
  // 3+ consecutive clean sheets → reduce opponent scoring lambda
  const homeCS = consecutiveCleanSheets(hR);
  if (homeCS >= 3) {
    const factor = homeCS >= 4 ? 0.80 : 0.87;
    flags.push({
      code: "MURALHA_DEFENSIVA",
      label: `${homeTeam}: ${homeCS} clean sheets consecutivos — muralha defensiva ativa`,
      severity: homeCS >= 4 ? "CRITICA" : "ALTA",
      team: "home",
      lambdaAdj: { lambdaAway: factor },
    });
  }
  const awayCS = consecutiveCleanSheets(aR);
  if (awayCS >= 3) {
    const factor = awayCS >= 4 ? 0.80 : 0.87;
    flags.push({
      code: "MURALHA_DEFENSIVA",
      label: `${awayTeam}: ${awayCS} clean sheets consecutivos — muralha defensiva ativa`,
      severity: awayCS >= 4 ? "CRITICA" : "ALTA",
      team: "away",
      lambdaAdj: { lambdaHome: factor },
    });
  }

  // ── CRISE_OFENSIVA ────────────────────────────────────────────────────────
  // 3+ consecutive scoreless games → reduce team's own scoring lambda
  const homeDrought = consecutiveScoringDrought(hR);
  if (homeDrought >= 3) {
    const factor = homeDrought >= 4 ? 0.70 : 0.78;
    flags.push({
      code: "CRISE_OFENSIVA",
      label: `${homeTeam}: ${homeDrought} jogos sem marcar — colapso ofensivo em andamento`,
      severity: "CRITICA",
      team: "home",
      lambdaAdj: { lambdaHome: factor },
    });
  }
  const awayDrought = consecutiveScoringDrought(aR);
  if (awayDrought >= 3) {
    const factor = awayDrought >= 4 ? 0.70 : 0.78;
    flags.push({
      code: "CRISE_OFENSIVA",
      label: `${awayTeam}: ${awayDrought} jogos sem marcar — colapso ofensivo em andamento`,
      severity: "CRITICA",
      team: "away",
      lambdaAdj: { lambdaAway: factor },
    });
  }

  // ── COLAPSO_DEFENSIVO ─────────────────────────────────────────────────────
  // Conceded 2+ goals in each of last 3 games → increase opponent scoring lambda
  const homeCollapse = consecutiveHighConcede(hR, 2);
  if (homeCollapse >= 3) {
    const factor = homeCollapse >= 4 ? 1.20 : 1.14;
    flags.push({
      code: "COLAPSO_DEFENSIVO",
      label: `${homeTeam}: sofreu 2+ gols em ${homeCollapse} jogos consecutivos — defesa em frangalhos`,
      severity: homeCollapse >= 4 ? "CRITICA" : "ALTA",
      team: "home",
      lambdaAdj: { lambdaAway: factor },
    });
  }
  const awayCollapse = consecutiveHighConcede(aR, 2);
  if (awayCollapse >= 3) {
    const factor = awayCollapse >= 4 ? 1.20 : 1.14;
    flags.push({
      code: "COLAPSO_DEFENSIVO",
      label: `${awayTeam}: sofreu 2+ gols em ${awayCollapse} jogos consecutivos — defesa em frangalhos`,
      severity: awayCollapse >= 4 ? "CRITICA" : "ALTA",
      team: "away",
      lambdaAdj: { lambdaHome: factor },
    });
  }

  // ── ALTA_VOLATILIDADE ─────────────────────────────────────────────────────
  // Both teams avg > 3.8 total goals in last 4 games → fireworks likely
  const homeAvgTotal = avgTotalGoals(homeHistory.slice(0, 4));
  const awayAvgTotal = avgTotalGoals(awayHistory.slice(0, 4));
  if (homeAvgTotal > 3.8 && awayAvgTotal > 3.8) {
    flags.push({
      code: "ALTA_VOLATILIDADE",
      label: `Confronto de alta entropia: ${homeTeam} avg ${homeAvgTotal.toFixed(1)} vs ${awayTeam} avg ${awayAvgTotal.toFixed(1)} gols/jogo`,
      severity: "ALTA",
      team: "both",
      lambdaAdj: { lambdaHome: 1.10, lambdaAway: 1.10 },
    });
  }

  // ── MOMENTUM_OFENSIVO ─────────────────────────────────────────────────────
  // Scored 2+ in each of last 3 games → boost team's scoring lambda
  const homeMomentum = consecutiveHighScore(hR, 2);
  if (homeMomentum >= 3) {
    flags.push({
      code: "MOMENTUM_OFENSIVO",
      label: `${homeTeam}: marcou 2+ gols em ${homeMomentum} jogos seguidos — momentum ofensivo`,
      severity: "MEDIA",
      team: "home",
      lambdaAdj: { lambdaHome: 1.10 },
    });
  }
  const awayMomentum = consecutiveHighScore(aR, 2);
  if (awayMomentum >= 3) {
    flags.push({
      code: "MOMENTUM_OFENSIVO",
      label: `${awayTeam}: marcou 2+ gols em ${awayMomentum} jogos seguidos — momentum ofensivo`,
      severity: "MEDIA",
      team: "away",
      lambdaAdj: { lambdaAway: 1.10 },
    });
  }

  // ── FADIGA_CRITICA ────────────────────────────────────────────────────────
  // 3+ games in last 10 days → fatigue reduces scoring and defensive solidity
  const homeFatigue = gamesInLastNDays(homeHistory, 10);
  if (homeFatigue >= 3) {
    flags.push({
      code: "FADIGA_CRITICA",
      label: `${homeTeam}: ${homeFatigue} jogos nos últimos 10 dias — sobrecarga física`,
      severity: homeFatigue >= 4 ? "CRITICA" : "ALTA",
      team: "home",
      lambdaAdj: { lambdaHome: 0.92, lambdaAway: 1.06 },
    });
  }
  const awayFatigue = gamesInLastNDays(awayHistory, 10);
  if (awayFatigue >= 3) {
    flags.push({
      code: "FADIGA_CRITICA",
      label: `${awayTeam}: ${awayFatigue} jogos nos últimos 10 dias — sobrecarga física`,
      severity: awayFatigue >= 4 ? "CRITICA" : "ALTA",
      team: "away",
      lambdaAdj: { lambdaAway: 0.92, lambdaHome: 1.06 },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EXTENDED FLAGS (v2)
  // ════════════════════════════════════════════════════════════════════════════

  // ── PADRAO_MINIMALISTA ────────────────────────────────────────────────────
  // Team wins most games by exactly 1 goal → pulls predictions toward 1-0/2-1
  // Threshold: ≥3 wins in last 5, of which ≥70% by a single goal margin
  const hWins = hR.filter((m) => m.goalsFor > m.goalsAgainst);
  if (hWins.length >= 3 && narrowWinRate(hR) >= 0.70) {
    flags.push({
      code: "PADRAO_MINIMALISTA",
      label: `${homeTeam}: ${Math.round(narrowWinRate(hR) * 100)}% das vitórias por 1 gol — padrão minimalista`,
      severity: "MEDIA",
      team: "home",
      // Slightly deflate both lambdas — encourages 1-goal scoreline prediction
      lambdaAdj: { lambdaHome: 0.95, lambdaAway: 0.93 },
    });
  }
  const aWins = aR.filter((m) => m.goalsFor > m.goalsAgainst);
  if (aWins.length >= 3 && narrowWinRate(aR) >= 0.70) {
    flags.push({
      code: "PADRAO_MINIMALISTA",
      label: `${awayTeam}: ${Math.round(narrowWinRate(aR) * 100)}% das vitórias por 1 gol — padrão minimalista`,
      severity: "MEDIA",
      team: "away",
      lambdaAdj: { lambdaHome: 0.93, lambdaAway: 0.95 },
    });
  }

  // ── FORCA_DEFENSIVA_SOLIDA ────────────────────────────────────────────────
  // Clean sheet rate > 50% in last 6 games → significantly reduce opponent lambda
  // (Separate from MURALHA which requires CONSECUTIVE sheets)
  const hCSRate = cleanSheetRate(hR6);
  if (hCSRate >= 0.5 && homeCS < 3) { // avoid double-flagging with MURALHA
    flags.push({
      code: "FORCA_DEFENSIVA_SOLIDA",
      label: `${homeTeam}: ${Math.round(hCSRate * 100)}% clean sheets nos últimos ${hR6.length} jogos — defesa sólida`,
      severity: hCSRate >= 0.67 ? "ALTA" : "MEDIA",
      team: "home",
      lambdaAdj: { lambdaAway: hCSRate >= 0.67 ? 0.88 : 0.93 },
    });
  }
  const aCSRate = cleanSheetRate(aR6);
  if (aCSRate >= 0.5 && awayCS < 3) {
    flags.push({
      code: "FORCA_DEFENSIVA_SOLIDA",
      label: `${awayTeam}: ${Math.round(aCSRate * 100)}% clean sheets nos últimos ${aR6.length} jogos — defesa sólida`,
      severity: aCSRate >= 0.67 ? "ALTA" : "MEDIA",
      team: "away",
      lambdaAdj: { lambdaHome: aCSRate >= 0.67 ? 0.88 : 0.93 },
    });
  }

  // ── TENDENCIA_BLOWOUT ─────────────────────────────────────────────────────
  // 3+ goals total (scored or conceded) in 3+ of last 5 games
  // Indicates matches tend to have high goal counts and extreme scores
  const hBlowouts = hR.filter((m) => m.goalsFor + m.goalsAgainst >= 4).length;
  const aBlowouts = aR.filter((m) => m.goalsFor + m.goalsAgainst >= 4).length;
  if (hBlowouts >= 3 && aBlowouts >= 3) {
    flags.push({
      code: "TENDENCIA_BLOWOUT",
      label: `Ambos times em jogos de alto gol: ${homeTeam} ${hBlowouts}/5, ${awayTeam} ${aBlowouts}/5 com 4+ gols`,
      severity: "ALTA",
      team: "both",
      lambdaAdj: { lambdaHome: 1.12, lambdaAway: 1.12 },
    });
  } else if (hBlowouts >= 3) {
    flags.push({
      code: "TENDENCIA_BLOWOUT",
      label: `${homeTeam}: ${hBlowouts}/5 jogos com 4+ gols — tendência de placar extremo`,
      severity: "MEDIA",
      team: "home",
      lambdaAdj: { lambdaHome: 1.07, lambdaAway: 1.07 },
    });
  } else if (aBlowouts >= 3) {
    flags.push({
      code: "TENDENCIA_BLOWOUT",
      label: `${awayTeam}: ${aBlowouts}/5 jogos com 4+ gols — tendência de placar extremo`,
      severity: "MEDIA",
      team: "away",
      lambdaAdj: { lambdaHome: 1.07, lambdaAway: 1.07 },
    });
  }

  // ── ATAQUE_EXPLOSIVO ──────────────────────────────────────────────────────
  // Scored 3+ goals in 2+ of last 5 games (not yet in MOMENTUM threshold)
  const hExplosive = countMatchesWithNPlusGoals(hR, 3);
  if (hExplosive >= 2 && homeMomentum < 3) {
    flags.push({
      code: "ATAQUE_EXPLOSIVO",
      label: `${homeTeam}: marcou 3+ gols em ${hExplosive}/5 jogos recentes — teto ofensivo alto`,
      severity: "MEDIA",
      team: "home",
      lambdaAdj: { lambdaHome: 1.08 },
    });
  }
  const aExplosive = countMatchesWithNPlusGoals(aR, 3);
  if (aExplosive >= 2 && awayMomentum < 3) {
    flags.push({
      code: "ATAQUE_EXPLOSIVO",
      label: `${awayTeam}: marcou 3+ gols em ${aExplosive}/5 jogos recentes — teto ofensivo alto`,
      severity: "MEDIA",
      team: "away",
      lambdaAdj: { lambdaAway: 1.08 },
    });
  }

  // ── DESEQUILIBRIO_MARCANTE ────────────────────────────────────────────────
  // Huge lambda asymmetry between teams → model should commit more to dominant side
  if (blendedLambdas) {
    const { lambdaHome: lh, lambdaAway: la } = blendedLambdas;
    const ratio = lh / Math.max(0.05, la);
    if (ratio >= 2.5) {
      flags.push({
        code: "DESEQUILIBRIO_MARCANTE",
        label: `Desequilíbrio ofensivo: ${homeTeam} λ=${lh.toFixed(2)} vs ${awayTeam} λ=${la.toFixed(2)} (ratio ${ratio.toFixed(1)}x)`,
        severity: "ALTA",
        team: "both",
        // Amplify the dominant team's scoring potential slightly
        lambdaAdj: { lambdaHome: 1.06 },
      });
    } else if (ratio <= 0.40) {
      flags.push({
        code: "DESEQUILIBRIO_MARCANTE",
        label: `Desequilíbrio ofensivo: ${awayTeam} λ=${la.toFixed(2)} domina vs ${homeTeam} λ=${lh.toFixed(2)} (ratio ${(1/ratio).toFixed(1)}x)`,
        severity: "ALTA",
        team: "both",
        lambdaAdj: { lambdaAway: 1.06 },
      });
    }
  }

  // ── FORMA_DIVERGENTE ──────────────────────────────────────────────────────
  // One team strongly improving (trend > +0.05 goals/day) while other declining
  // This regime change is missed by static form models
  const hTrend = formTrendSlope(homeHistory.slice(0, 7));
  const aTrend = formTrendSlope(awayHistory.slice(0, 7));
  // hTrend < 0 = more goals recently = home improving
  // aTrend > 0 = fewer goals recently = away declining
  if (hTrend < -0.04 && aTrend > 0.04) {
    flags.push({
      code: "FORMA_DIVERGENTE",
      label: `Trajetórias opostas: ${homeTeam} em crescimento vs ${awayTeam} em declínio ofensivo`,
      severity: "ALTA",
      team: "both",
      lambdaAdj: { lambdaHome: 1.07, lambdaAway: 0.93 },
    });
  } else if (aTrend < -0.04 && hTrend > 0.04) {
    flags.push({
      code: "FORMA_DIVERGENTE",
      label: `Trajetórias opostas: ${awayTeam} em crescimento vs ${homeTeam} em declínio ofensivo`,
      severity: "ALTA",
      team: "both",
      lambdaAdj: { lambdaHome: 0.93, lambdaAway: 1.07 },
    });
  }

  // ── INCONSISTENCIA_EXTREMA ────────────────────────────────────────────────
  // Very high goal variance (> 2.5) → NegBin model gets more weight indirectly,
  // but we also flag this for the driver text
  const hVar = goalsVariance(hR);
  if (hVar > 2.5) {
    flags.push({
      code: "INCONSISTENCIA_EXTREMA",
      label: `${homeTeam}: variância ofensiva extrema (σ²=${hVar.toFixed(1)}) — placar imprevisível`,
      severity: "MEDIA",
      team: "home",
      // No lambda adjustment — just a diagnostic flag
      lambdaAdj: {},
    });
  }
  const aVar = goalsVariance(aR);
  if (aVar > 2.5) {
    flags.push({
      code: "INCONSISTENCIA_EXTREMA",
      label: `${awayTeam}: variância ofensiva extrema (σ²=${aVar.toFixed(1)}) — placar imprevisível`,
      severity: "MEDIA",
      team: "away",
      lambdaAdj: {},
    });
  }

  return flags;
}

/**
 * Flatten flags to display strings with severity prefix.
 */
export function flagsToLabels(flags: XRayFlag[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of flags) {
    if (!seen.has(f.label)) {
      seen.add(f.label);
      out.push(`[${f.code}|${f.severity}] ${f.label}`);
    }
  }
  return out;
}

/**
 * Compute the net lambda multipliers after applying all flags.
 */
export function applyFlagAdjustments(
  lambdaHome: number,
  lambdaAway: number,
  flags: XRayFlag[],
): { lambdaHome: number; lambdaAway: number } {
  let lh = lambdaHome;
  let la = lambdaAway;
  for (const f of flags) {
    if (f.lambdaAdj.lambdaHome !== undefined) lh *= f.lambdaAdj.lambdaHome;
    if (f.lambdaAdj.lambdaAway !== undefined) la *= f.lambdaAdj.lambdaAway;
  }
  // Allow up to 8 (matches strengthsToLambdas ceiling)
  return {
    lambdaHome: Math.max(0.1, Math.min(8, lh)),
    lambdaAway: Math.max(0.1, Math.min(8, la)),
  };
}
