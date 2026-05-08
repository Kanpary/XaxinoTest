/**
 * Live recalibration service.
 *
 * Given a fixtureId + leagueId, fetches the current live state from ESPN,
 * re-runs the full 80-method engine with the in-progress score, and returns
 * the 3 best final-score predictions conditioned on the current state.
 */

import {
  fetchScoreboard,
  fetchTeamScheduleMultiSeason,
  extractPastResults,
  fetchLiveMatchStats,
  type EspnFixture,
} from "../data-sources/espn";
import { fetchWeather } from "../data-sources/weather";
import { findLeague } from "../data-sources/leagues";
import { scanFixture } from "../engine/scanner";
import { getModelState } from "./model-state-service";
import { getElo, applyEloMatch } from "./elo-service";
import { fetchBettingMarkets } from "../data-sources/odds";
import { logger } from "../lib/logger";
import type { PastResult } from "../data-sources/espn";
import type { PastMatch } from "../engine/weighted-form";

export interface LiveRecalibratePick {
  home: number;
  away: number;
  prob: number;
  finalProb: number;
  confidencePct: number;
  label: string;
}

export interface OverUnderSuggestion {
  line: number;
  recommendation: "OVER" | "UNDER";
  prob: number;
}

export interface HtFtSuggestion {
  ht: string;   // "1" | "X" | "2"
  ft: string;   // "1" | "X" | "2"
  label: string;
  prob: number;
}

export interface LiveRecalibrateOut {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  liveMinute: number;
  liveHomeScore: number;
  liveAwayScore: number;
  top3: LiveRecalibratePick[];
  assertiveness: number;
  convergence: number;
  zScore: number;
  analysisContext: string;
  recalibratedAt: string;
  /** BTTS probability derived from 80-method engine (M79 + Monte Carlo blend) */
  bttsProb: number;
  /** Over/Under goal line suggestions with model-derived probabilities */
  overUnderSuggestions: OverUnderSuggestion[];
  /** Half-Time / Full-Time market suggestions */
  htFtSuggestions: HtFtSuggestion[];
  /** Real bookmaker odds when ODDS_API_KEY is configured */
  bettingMarkets?: import("../data-sources/odds").BettingMarketsData | null;
  /** Whether this was a live game at recalibration time */
  isLive: boolean;
  /** Real-time match stats from ESPN boxscore (null for pre-game or when ESPN unavailable) */
  liveStats?: import("../data-sources/espn").LiveMatchStats | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(Math.max(1e-15, lambda));
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Poisson CDF: P(X <= maxK) */
function poissonCDF(lambda: number, maxK: number): number {
  let cdf = 0;
  let term = Math.exp(-lambda);
  for (let k = 0; k <= maxK; k++) {
    cdf += term;
    term *= lambda / (k + 1);
  }
  return Math.min(1, cdf);
}

// ─── Market suggestion helpers ────────────────────────────────────────────────

/**
 * Score-anchored Over/Under suggestions.
 * Adjusts lines by the current total goals already scored so probabilities
 * reflect the FINAL total (not just remaining goals).
 */
function computeOverUnderSuggestions(
  mcStats: { over15: number; over25: number; avgTotalGoals: number },
  topN: Array<{ home: number; away: number; prob: number }>,
  currentHomeScore: number,
  currentAwayScore: number,
  isLive: boolean,
): OverUnderSuggestion[] {
  const currentTotal = currentHomeScore + currentAwayScore;

  // The mcStats from the engine are already score-anchored for live games (liveMcStats).
  // For pre-game, they represent the full-match distribution — no adjustment needed.
  const over15 = mcStats.over15;
  const over25 = mcStats.over25;

  // Over 3.5 — estimated from topN distribution
  const topTotal = topN.reduce((s, c) => s + c.prob, 0);
  const over35Raw = topN.filter((s) => s.home + s.away > 3).reduce((s, c) => s + c.prob, 0);
  const over35 = topTotal > 0 ? over35Raw / topTotal : 0;

  // Over 4.5 — for high-scoring games
  const over45Raw = topN.filter((s) => s.home + s.away > 4).reduce((s, c) => s + c.prob, 0);
  const over45 = topTotal > 0 ? over45Raw / topTotal : 0;

  // For live games, add ultra-specific live-remaining lines too
  const suggestions: OverUnderSuggestion[] = [];

  const lines: Array<{ line: number; overProb: number }> = [
    { line: 1.5, overProb: over15 },
    { line: 2.5, overProb: over25 },
    { line: 3.5, overProb: over35 },
    ...(over45 > 0.20 || over45 < 0.80 ? [{ line: 4.5, overProb: over45 }] : []),
  ];

  // For live games that have already passed some lines, handle 100% cases
  if (isLive) {
    if (currentTotal >= 2) suggestions.push({ line: 1.5, recommendation: "OVER", prob: 1.0 });
    if (currentTotal >= 3) suggestions.push({ line: 2.5, recommendation: "OVER", prob: 1.0 });
    if (currentTotal >= 4) suggestions.push({ line: 3.5, recommendation: "OVER", prob: 1.0 });
  }

  const alreadyPushed = new Set(suggestions.map((s) => s.line));

  for (const { line, overProb } of lines) {
    if (alreadyPushed.has(line)) continue;
    if (overProb >= 0.57) {
      suggestions.push({ line, recommendation: "OVER", prob: overProb });
    } else if (overProb <= 0.43) {
      suggestions.push({ line, recommendation: "UNDER", prob: 1 - overProb });
    }
  }

  // Always include 2.5 as the primary reference
  if (!suggestions.find((s) => s.line === 2.5)) {
    const rec = over25 >= 0.50 ? "OVER" : "UNDER";
    suggestions.push({ line: 2.5, recommendation: rec, prob: rec === "OVER" ? over25 : 1 - over25 });
  }

  suggestions.sort((a, b) => {
    // 100% certain bets last (least interesting to show), high-edge bets first
    if (a.prob === 1.0 && b.prob < 1.0) return 1;
    if (b.prob === 1.0 && a.prob < 1.0) return -1;
    return b.prob - a.prob;
  });
  return suggestions.slice(0, 4);
}

/**
 * HT/FT suggestions — live-aware.
 * For 2nd half: HT is known to be the direction of the score trajectory.
 * Uses live 1X2 Markov probs (score-anchored) for FT.
 */
function computeHtFtSuggestions(
  topN: Array<{ home: number; away: number; prob: number }>,
  mcStats: { homeWinProb: number; drawProb: number; awayWinProb: number; avgTotalGoals: number },
  liveMinute: number,
  liveHomeScore: number,
  liveAwayScore: number,
  isLive: boolean,
): HtFtSuggestion[] {
  // FT 1X2 from score-anchored mcStats (already Markov-blended for live games)
  const ftHome = mcStats.homeWinProb;
  const ftDraw  = mcStats.drawProb;
  const ftAway  = mcStats.awayWinProb;

  let htHome: number;
  let htDraw: number;
  let htAway: number;

  if (isLive && liveMinute >= 45) {
    // 2nd half: HT result has already occurred. We don't have the exact HT score,
    // but the current scoreline direction gives strong evidence about what HT was.
    // Model HT result probability via the current direction (heuristic).
    const diff = liveHomeScore - liveAwayScore;
    if (diff > 1) {
      // Home winning comfortably — likely won at HT too
      htHome = 0.72; htDraw = 0.20; htAway = 0.08;
    } else if (diff === 1) {
      // Home winning narrowly — mix of HT results possible
      htHome = 0.55; htDraw = 0.30; htAway = 0.15;
    } else if (diff === 0) {
      // Currently level — draw at HT is most likely
      htHome = 0.25; htDraw = 0.55; htAway = 0.20;
    } else if (diff === -1) {
      // Away winning narrowly
      htHome = 0.15; htDraw = 0.30; htAway = 0.55;
    } else {
      // Away winning comfortably
      htHome = 0.08; htDraw = 0.20; htAway = 0.72;
    }
  } else if (isLive && liveMinute > 0 && liveMinute < 45) {
    // 1st half live: HT is imminent, current score is strong evidence.
    // FIX: topN contains FINAL scores (with live offset applied by scanner.ts).
    // For HT prediction, we need remaining goals to HT, not full-game final scores.
    // Subtract current score from topN to get remaining-goal distribution, then
    // scale by fraction of 1st half remaining (minsToHT / 45).
    const minsToHT = Math.max(0, 45 - liveMinute);
    const remainingFracHT = minsToHT / 45;

    // Compute remaining-goal weighted averages from topN (subtract current score)
    let wRemH = 0, wRemA = 0, wTotal = 0;
    for (const s of topN.slice(0, 12)) {
      const remH = Math.max(0, s.home - liveHomeScore);
      const remA = Math.max(0, s.away - liveAwayScore);
      wRemH  += remH * s.prob;
      wRemA  += remA * s.prob;
      wTotal += s.prob;
    }
    // Remaining goals for whole second half of game → scale to remaining 1st-half mins
    const lambdaRemFTH = wTotal > 0 ? wRemH / wTotal : mcStats.avgTotalGoals * 0.25;
    const lambdaRemFTA = wTotal > 0 ? wRemA / wTotal : mcStats.avgTotalGoals * 0.23;
    // Scale to remaining 1st-half minutes; remaining is already a fraction of (90-liveMinute)
    // but we only want the fraction that falls in the first half.
    const fullRemFrac = Math.max(0.01, (90 - liveMinute) / 90);
    const htFrac = fullRemFrac > 0 ? remainingFracHT / 90 / (fullRemFrac / 90) : 0;
    const lambdaHTH = Math.max(0.01, lambdaRemFTH * htFrac);
    const lambdaHTA = Math.max(0.01, lambdaRemFTA * htFrac);

    // Compute HT result probability: current score + Poisson remaining-to-HT goals
    htHome = 0; htDraw = 0; htAway = 0;
    const maxRem = 4;
    for (let h = 0; h <= maxRem; h++) {
      for (let a = 0; a <= maxRem; a++) {
        const p = poissonPMF(h, lambdaHTH) * poissonPMF(a, lambdaHTA);
        const htH = liveHomeScore + h;
        const htA = liveAwayScore + a;
        if (htH > htA) htHome += p;
        else if (htH === htA) htDraw += p;
        else htAway += p;
      }
    }
    const htTotal = htHome + htDraw + htAway;
    if (htTotal > 0) { htHome /= htTotal; htDraw /= htTotal; htAway /= htTotal; }
  } else {
    // Pre-game: derive HT probs from topN using Poisson at 45'
    // topN contains final score predictions; for pre-game, no offset → scores = final predictions.
    let wHome = 0, wAway = 0, wTotal = 0;
    for (const s of topN.slice(0, 12)) {
      wHome  += s.home * s.prob;
      wAway  += s.away * s.prob;
      wTotal += s.prob;
    }
    const lambdaFTH = wTotal > 0 ? wHome / wTotal : mcStats.avgTotalGoals * 0.52;
    const lambdaFTA = wTotal > 0 ? wAway / wTotal : mcStats.avgTotalGoals * 0.48;
    // HT occurs at ~45% of the match rate
    const lambdaHTH = lambdaFTH * 0.45;
    const lambdaHTA = lambdaFTA * 0.45;

    htHome = 0; htDraw = 0; htAway = 0;
    const maxHT = 5;
    for (let h = 0; h <= maxHT; h++) {
      for (let a = 0; a <= maxHT; a++) {
        const p = poissonPMF(h, lambdaHTH) * poissonPMF(a, lambdaHTA);
        if (h > a) htHome += p;
        else if (h === a) htDraw += p;
        else htAway += p;
      }
    }
    const htTotal = htHome + htDraw + htAway;
    if (htTotal > 0) { htHome /= htTotal; htDraw /= htTotal; htAway /= htTotal; }
  }

  const raw: HtFtSuggestion[] = [
    { ht: "1", ft: "1", label: "Casa/Casa",      prob: htHome * ftHome },
    { ht: "X", ft: "1", label: "Empate/Casa",    prob: htDraw * ftHome },
    { ht: "2", ft: "1", label: "Fora/Casa",      prob: htAway * ftHome },
    { ht: "1", ft: "X", label: "Casa/Empate",    prob: htHome * ftDraw },
    { ht: "X", ft: "X", label: "Empate/Empate",  prob: htDraw * ftDraw },
    { ht: "2", ft: "X", label: "Fora/Empate",    prob: htAway * ftDraw },
    { ht: "1", ft: "2", label: "Casa/Fora",      prob: htHome * ftAway },
    { ht: "X", ft: "2", label: "Empate/Fora",    prob: htDraw * ftAway },
    { ht: "2", ft: "2", label: "Fora/Fora",      prob: htAway * ftAway },
  ];

  // For live 2nd half games: filter out HT/FT combos that are impossible given current state.
  // E.g. if current score is 2-0 (home winning), a "HT=2/FT=1 (Fora/Casa)" is very unlikely
  // to be impossible (away would need to overturn a 2-goal deficit). Keep all combos but
  // filter out logically impossible ones (e.g. HT=Home winning but FT=Away with no comeback).
  // This is already handled probabilistically by the Markov-anchored ftHome/ftDraw/ftAway.

  const total = raw.reduce((s, c) => s + c.prob, 0);
  if (total > 0) for (const c of raw) c.prob /= total;

  raw.sort((a, b) => b.prob - a.prob);
  return raw.slice(0, 4);
}

// ─── Rich analysis context builder ───────────────────────────────────────────

function buildContext(
  homeTeam: string,
  awayTeam: string,
  liveMinute: number,
  liveHomeScore: number,
  liveAwayScore: number,
  top3: LiveRecalibratePick[],
  assertiveness: number,
  convergence: number,
  report: {
    mcStats: { homeWinProb: number; drawProb: number; awayWinProb: number; bttsProb: number; over25: number; avgTotalGoals: number };
    liveMarkov: { homeWinProb: number; drawProb: number; awayWinProb: number; remainingGoalsHome: number; remainingGoalsAway: number } | null;
    hawkesAnalysis: { probAnotherGoal: number; projectedHome: number; projectedAway: number };
    xRayFlags: string[];
    xRayDriver: string;
    momentumCarry: { homeLabel: string; awayLabel: string; homeMomentum: number; awayMomentum: number };
    homeForm: { avgGoalsFor: number; avgGoalsAgainst: number; weightedAttack: number; eloRating: number };
    awayForm: { avgGoalsFor: number; avgGoalsAgainst: number; weightedAttack: number; eloRating: number };
    ensembleConvergence: number;
    zScore: number;
    tacticalMatchup: { matchupLabel: string; isDefensiveClash: boolean; isHighScoringExpected: boolean };
    scorelinePatterns?: { bttsProb: number; lateGoalBias: number } | null;
    bettingMarkets?: import("../data-sources/odds").BettingMarketsData | null;
    liveContextAnalysis?: { remainingLambdaHome: number; remainingLambdaAway: number; estimatedInjuryTime: number } | null;
  },
  isLive: boolean,
  liveStats?: import("../data-sources/espn").LiveMatchStats | null,
): string {
  const parts: string[] = [];

  // ── Situational intro ───────────────────────────────────────────────────
  if (isLive) {
    const minutesLeft = 90 - liveMinute;
    const diff = liveHomeScore - liveAwayScore;
    const halfLabel = liveMinute >= 45 ? "2ª etapa" : "1ª etapa";
    const timePhase = liveMinute >= 80 ? "reta final" : liveMinute >= 65 ? "70s" : liveMinute >= 45 ? "2ª etapa" : liveMinute >= 30 ? "30-45'" : "início";

    const scoreState = diff > 1 ? `${homeTeam} domina por ${diff} gols`
      : diff === 1 ? `${homeTeam} vence por 1 gol`
      : diff === 0 ? "partida empatada"
      : diff === -1 ? `${awayTeam} vence por 1 gol`
      : `${awayTeam} domina por ${Math.abs(diff)} gols`;

    parts.push(`⏱ AO VIVO ${liveMinute}' (${halfLabel} — ${minutesLeft} min restantes): ${liveHomeScore}–${liveAwayScore} | ${scoreState}.`);

    // Urgency signal
    if (liveMinute >= 75) {
      parts.push(`🔴 ${timePhase.toUpperCase()}: janela de apostas se fecha — modelo reavaliado com ${minutesLeft} min restantes.`);
    }
  } else {
    parts.push(`📊 Análise pré-jogo: motor 80 métodos executado para ${homeTeam} × ${awayTeam}.`);
  }

  // ── Top prediction ──────────────────────────────────────────────────────
  const top = top3[0];
  if (top) {
    const confLabel = top.confidencePct >= 25 ? "alta confiança" : top.confidencePct >= 14 ? "confiança moderada" : "spread amplo";
    parts.push(`🎯 Placar projetado: ${top.home}–${top.away} (${top.confidencePct.toFixed(1)}% — ${confLabel}).`);
    if (top3[1]) parts.push(`Variante: ${top3[1].home}–${top3[1].away} (${top3[1].confidencePct.toFixed(1)}%).`);
  }

  // ── Live 1X2 probabilities ───────────────────────────────────────────────
  const hw = (report.mcStats.homeWinProb * 100).toFixed(0);
  const dw = (report.mcStats.drawProb * 100).toFixed(0);
  const aw = (report.mcStats.awayWinProb * 100).toFixed(0);
  const dominant =
    report.mcStats.homeWinProb > 0.55 ? `${homeTeam} favorito`
    : report.mcStats.awayWinProb > 0.55 ? `${awayTeam} favorito`
    : "disputa aberta";
  parts.push(`📈 1X2 ${isLive ? "ao vivo" : "pré-jogo"}: Casa ${hw}% | Empate ${dw}% | Fora ${aw}% — ${dominant}.`);

  // ── Remaining goals projection ───────────────────────────────────────────
  if (isLive && report.liveMarkov) {
    const remH = report.liveMarkov.remainingGoalsHome.toFixed(2);
    const remA = report.liveMarkov.remainingGoalsAway.toFixed(2);
    const pGoal = (report.hawkesAnalysis.probAnotherGoal * 100).toFixed(0);
    parts.push(`⚡ Markov: λ restante ${remH} (casa) + ${remA} (fora) = ${(parseFloat(remH) + parseFloat(remA)).toFixed(2)} gols esperados | P(mais 1 gol) ${pGoal}%.`);
  } else if (!isLive) {
    const projH = report.hawkesAnalysis.projectedHome.toFixed(2);
    const projA = report.hawkesAnalysis.projectedAway.toFixed(2);
    parts.push(`📉 Projeção Hawkes: ${projH} (casa) + ${projA} (fora) = ${(parseFloat(projH) + parseFloat(projA)).toFixed(2)} gols esperados.`);
  }

  // ── Live xG tracking (M54 Bayesian blend) ────────────────────────────────
  if (isLive && liveStats) {
    const hasXg = liveStats.homeXg !== null && liveStats.awayXg !== null;
    const shotLine = `${liveStats.homeShots} finalizações (${liveStats.homeShotsOnTarget} no gol) vs ${liveStats.awayShots} (${liveStats.awayShotsOnTarget} no gol)`;
    if (hasXg) {
      const hXg = (liveStats.homeXg as number).toFixed(2);
      const aXg = (liveStats.awayXg as number).toFixed(2);
      const xgDiff = ((liveStats.homeXg as number) - (liveStats.awayXg as number)).toFixed(2);
      const xgLabel = parseFloat(xgDiff) > 0.3 ? `${homeTeam} criando mais` : parseFloat(xgDiff) < -0.3 ? `${awayTeam} criando mais` : "equilíbrio de chances";
      parts.push(`📡 xG ao vivo: Casa ${hXg} | Fora ${aXg} (${xgLabel}) — alimentado no modelo M54. ${shotLine}.`);
    } else if (liveStats.homeShots > 0 || liveStats.awayShots > 0) {
      parts.push(`📡 Finalizações: ${shotLine} — xG estimado via conversão de chutes.`);
    }
    if (liveStats.homeRedCards > 0 || liveStats.awayRedCards > 0) {
      const rcParts: string[] = [];
      if (liveStats.homeRedCards > 0) rcParts.push(`Casa: ${liveStats.homeRedCards} vermelho(s)`);
      if (liveStats.awayRedCards > 0) rcParts.push(`Fora: ${liveStats.awayRedCards} vermelho(s)`);
      parts.push(`🟥 Expulsões: ${rcParts.join(" | ")} — ajuste M55 aplicado.`);
    }
  }

  // ── BTTS & Over ──────────────────────────────────────────────────────────
  const btts = (report.mcStats.bttsProb * 100).toFixed(0);
  const over25 = (report.mcStats.over25 * 100).toFixed(0);
  const lateGoal = report.scorelinePatterns?.lateGoalBias;
  const lateGoalTxt = lateGoal && lateGoal > 1.05 ? ` | viés de gol tardio +${((lateGoal - 1) * 100).toFixed(0)}%` : "";
  parts.push(`⚽ BTTS ${btts}% | Over 2.5 ${over25}%${lateGoalTxt}.`);

  // ── Momentum & form signals ───────────────────────────────────────────────
  const homeMom = report.momentumCarry.homeMomentum;
  const awayMom = report.momentumCarry.awayMomentum;
  if (Math.abs(homeMom - 1.0) > 0.10 || Math.abs(awayMom - 1.0) > 0.10) {
    const momParts: string[] = [];
    if (Math.abs(homeMom - 1.0) > 0.10) momParts.push(`${homeTeam} momentum ${report.momentumCarry.homeLabel} (×${homeMom.toFixed(2)})`);
    if (Math.abs(awayMom - 1.0) > 0.10) momParts.push(`${awayTeam} momentum ${report.momentumCarry.awayLabel} (×${awayMom.toFixed(2)})`);
    parts.push(`🔥 ${momParts.join(" | ")}.`);
  }

  // ── Tactical matchup ─────────────────────────────────────────────────────
  const tactical = report.tacticalMatchup;
  if (tactical.isDefensiveClash) {
    parts.push(`🛡 Confronto defensivo detectado: ${tactical.matchupLabel} — viés Under.`);
  } else if (tactical.isHighScoringExpected) {
    parts.push(`💥 Jogo aberto esperado: ${tactical.matchupLabel} — viés Over.`);
  } else {
    parts.push(`⚔ Perfil tático: ${tactical.matchupLabel}.`);
  }

  // ── Model confidence ─────────────────────────────────────────────────────
  const convLabel = convergence >= 0.80 ? "alta convergência" : convergence >= 0.60 ? "convergência moderada" : "baixa convergência";
  const assertLabel = assertiveness >= 0.20 ? "assertividade elevada" : assertiveness >= 0.12 ? "assertividade moderada" : "spread amplo";
  parts.push(`🧠 Motor 80 métodos: ${convLabel} (${(convergence * 100).toFixed(0)}%) | ${assertLabel} (${(assertiveness * 100).toFixed(1)}%) | z=${report.zScore.toFixed(2)}.`);

  // ── X-RAY critical flags ─────────────────────────────────────────────────
  const critFlags = report.xRayFlags.filter((f) => f.includes("CRITICA") || f.includes("ALTA"));
  if (critFlags.length > 0) {
    parts.push(`🔍 X-RAY: ${critFlags.slice(0, 2).map((f) => f.replace(/^\[.*?\]\s*/, "")).join(" | ")}.`);
  }

  // ── Bookmaker intelligence ────────────────────────────────────────────────
  if (report.bettingMarkets?.oneX2) {
    const bm = report.bettingMarkets.oneX2;
    const modelHomeImplied = 1 / Math.max(0.01, report.mcStats.homeWinProb);
    const edge =
      bm.homeOdd && bm.homeOdd > 0
        ? ((report.mcStats.homeWinProb - 1 / bm.homeOdd) * 100).toFixed(1)
        : null;
    if (edge && parseFloat(edge) > 3) {
      parts.push(`💰 Borda de valor: Casa ${bm.homeOdd?.toFixed(2)} vs justo ${modelHomeImplied.toFixed(2)} — edge +${edge}%.`);
    } else if (report.bettingMarkets?.overUnder?.[0]) {
      const ou = report.bettingMarkets.overUnder[0];
      parts.push(`📊 Linha O/U ${ou.line}: Over ${ou.overOdd?.toFixed(2)} / Under ${ou.underOdd?.toFixed(2)}.`);
    }
  }

  // ── Injury time note for late live games ────────────────────────────────
  if (isLive && liveMinute >= 85 && report.liveContextAnalysis) {
    const it = report.liveContextAnalysis.estimatedInjuryTime;
    parts.push(`⏱ Tempo adicional estimado: +${it} min.`);
  }

  return parts.join(" ");
}

// ─── Utility functions ────────────────────────────────────────────────────────

function todayBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isoToYYYYMMDD(iso: string): string {
  return iso.replace(/-/g, "");
}

function daysAgo(date: string, ref: Date): number {
  return Math.max(0, Math.floor((+ref - +new Date(date)) / 86_400_000));
}

function pastResultsToMatches(results: PastResult[], ref: Date): PastMatch[] {
  return results
    .map((r) => ({
      daysAgo: daysAgo(r.date, ref),
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      isHome: r.isHome,
    }))
    .slice(0, 20);
}

function matchesTeam(r: PastResult, teamId: string, teamName: string): boolean {
  if (r.opponentId && r.opponentId === teamId) return true;
  if (!r.opponentId && r.opponent) {
    const rn = r.opponent.toLowerCase().replace(/[^a-z0-9]/g, "");
    const tn = teamName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (rn.length >= 3 && tn.length >= 3)
      return rn.includes(tn.slice(0, 5)) || tn.includes(rn.slice(0, 5));
  }
  return false;
}

function findH2H(
  homeResults: PastResult[],
  homeTeamId: string,
  homeTeamName: string,
  awayResults: PastResult[],
  awayTeamId: string,
  awayTeamName: string,
  ref: Date,
): PastMatch[] {
  const fromHome = homeResults
    .filter((r) => matchesTeam(r, awayTeamId, awayTeamName))
    .map((r) => ({ date: r.date, daysAgo: daysAgo(r.date, ref), goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, isHome: r.isHome }));
  const fromAway = awayResults
    .filter((r) => matchesTeam(r, homeTeamId, homeTeamName))
    .map((r) => ({ date: r.date, daysAgo: daysAgo(r.date, ref), goalsFor: r.goalsAgainst, goalsAgainst: r.goalsFor, isHome: !r.isHome }));
  const merged = [...fromHome];
  for (const c of fromAway) {
    const tA = new Date(c.date).getTime();
    if (!merged.some((e) => Math.abs(+new Date(e.date) - tA) < 48 * 3_600_000))
      merged.push(c);
  }
  merged.sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return merged.slice(0, 12).map(({ daysAgo: da, goalsFor, goalsAgainst, isHome }) => ({ daysAgo: da, goalsFor, goalsAgainst, isHome }));
}

function parseLiveMinute(ev: EspnFixture): number {
  // Primary: shortDetail is most reliable — already formatted like "45'", "90+2'", "HT"
  const shortDetail = ev.status.type.shortDetail ?? "";
  const sdMatch = shortDetail.match(/^(\d+)(?:\+\d+)?/);
  if (sdMatch) {
    const min = parseInt(sdMatch[1], 10);
    if (!isNaN(min) && min >= 1 && min <= 120) {
      return min;
    }
  }
  if (shortDetail === "HT" || shortDetail.toLowerCase().includes("halftime")) return 45;

  // Fallback: displayClock + period
  const period = ev.status.period ?? 1;
  const clockStr = ev.status.displayClock ?? "";
  const minStr = clockStr.split(":")[0] ?? "0";
  const clockMin = Math.max(0, parseInt(minStr, 10));

  if (period === 1) return Math.max(1, Math.min(45, clockMin || 1));
  if (period >= 2) {
    const elapsed = clockMin > 45 ? clockMin : 45 + clockMin;
    return Math.max(46, Math.min(120, elapsed));
  }
  return 1;
}

// ─── Score coherence validator ────────────────────────────────────────────────

/**
 * Ensure all top3 picks respect the current live score.
 * If the engine returns a score below the current score (should not happen
 * after the space-mismatch fix, but guard defensively), clamp it.
 */
function validateLiveTop3(
  top3: LiveRecalibratePick[],
  liveHomeScore: number,
  liveAwayScore: number,
  isLive: boolean,
): LiveRecalibratePick[] {
  if (!isLive) return top3;
  return top3.map((pick) => ({
    ...pick,
    home: Math.max(pick.home, liveHomeScore),
    away: Math.max(pick.away, liveAwayScore),
  }));
}

// ─── Main service ─────────────────────────────────────────────────────────────

export async function liveRecalibrateFixture(
  fixtureId: string,
  leagueId: string,
): Promise<LiveRecalibrateOut> {
  const league = findLeague(leagueId);
  if (!league) throw new Error(`Liga não encontrada: ${leagueId}`);

  const dateBR = todayBrasilia();
  const dateYYYYMMDD = isoToYYYYMMDD(dateBR);

  const events = await fetchScoreboard(league.espnSlug, dateYYYYMMDD);
  const ev = events.find((e) => e.id === fixtureId);
  if (!ev) throw new Error(`Fixture ${fixtureId} não encontrado no scoreboard de hoje`);

  const comp = ev.competitions?.[0];
  if (!comp) throw new Error("Dados de competição ausentes");

  const homeComp = comp.competitors.find((c) => c.homeAway === "home");
  const awayComp = comp.competitors.find((c) => c.homeAway === "away");
  if (!homeComp || !awayComp) throw new Error("Competidores não encontrados");

  // Parse live score
  const liveHomeScore = homeComp.score != null ? Number(homeComp.score) : 0;
  const liveAwayScore = awayComp.score != null ? Number(awayComp.score) : 0;
  const liveMinute = parseLiveMinute(ev);
  const isLive = ev.status.type.state === "in";

  logger.info(
    { fixtureId, league: leagueId, minute: liveMinute, score: `${liveHomeScore}-${liveAwayScore}`, isLive },
    "Live recalibration requested",
  );

  const kickoff = new Date(ev.date);
  const refDate = new Date();

  const [homeSchedule, awaySchedule, bettingMarkets] = await Promise.all([
    fetchTeamScheduleMultiSeason(league.espnSlug, homeComp.team.id),
    fetchTeamScheduleMultiSeason(league.espnSlug, awayComp.team.id),
    fetchBettingMarkets(league.id, homeComp.team.displayName, awayComp.team.displayName, kickoff),
  ]);

  const homeResults = extractPastResults(homeSchedule, homeComp.team.id, refDate);
  const awayResults = extractPastResults(awaySchedule, awayComp.team.id, refDate);

  // Bootstrap Elo from history
  const recent = [
    ...homeResults.slice(0, 12).map((r) => ({ team: homeComp.team.displayName, r })),
    ...awayResults.slice(0, 12).map((r) => ({ team: awayComp.team.displayName, r })),
  ].sort((a, b) => +new Date(a.r.date) - +new Date(b.r.date));
  for (const { team, r } of recent) {
    const opp = r.opponent;
    if (!opp) continue;
    if (r.isHome) await applyEloMatch(league.id, team, opp, r.goalsFor, r.goalsAgainst);
    else await applyEloMatch(league.id, opp, team, r.goalsAgainst, r.goalsFor);
  }

  const homeElo = await getElo(league.id, homeComp.team.displayName);
  const awayElo = await getElo(league.id, awayComp.team.displayName);

  const venueCity = ev.venue?.address?.city ?? comp.venue?.address?.city;
  const venueCountry = ev.venue?.address?.country ?? comp.venue?.address?.country;
  const weather = await fetchWeather(venueCity, venueCountry, kickoff);

  const homeHistory = pastResultsToMatches(homeResults, refDate);
  const awayHistory = pastResultsToMatches(awayResults, refDate);
  const h2h = findH2H(
    homeResults, homeComp.team.id, homeComp.team.displayName,
    awayResults, awayComp.team.id, awayComp.team.displayName,
    refDate,
  );

  const daysRestHome = homeResults[0] ? daysAgo(homeResults[0].date, refDate) : 7;
  const daysRestAway = awayResults[0] ? daysAgo(awayResults[0].date, refDate) : 7;

  const modelState = await getModelState();

  const marketOddsForBlend = bettingMarkets
    ? { oneX2: bettingMarkets.oneX2, overUnder: bettingMarkets.overUnder, btts: bettingMarkets.btts }
    : undefined;

  // Only inject liveState for in-progress games. Pre-game analysis uses the full
  // 90-minute engine (no time-scaling needed; all lambdas represent full-game rates).
  // For live games, also fetch real-time stats (shots, xG, red cards) to feed M54-57.
  let liveState: {
    minute: number; homeScore: number; awayScore: number;
    homeXg?: number; awayXg?: number;
    homeRedCards?: number; awayRedCards?: number;
  } | undefined;
  let liveStats: Awaited<ReturnType<typeof fetchLiveMatchStats>> = null;
  if (isLive) {
    liveStats = await fetchLiveMatchStats(league.espnSlug, ev.id).catch(() => null);
    liveState = {
      minute:       Math.max(1, liveMinute),
      homeScore:    liveHomeScore,
      awayScore:    liveAwayScore,
      homeXg:       liveStats?.homeXg      ?? undefined,
      awayXg:       liveStats?.awayXg      ?? undefined,
      homeRedCards: liveStats?.homeRedCards ?? undefined,
      awayRedCards: liveStats?.awayRedCards ?? undefined,
    };
    logger.info(
      {
        fixtureId: ev.id,
        minute: liveMinute,
        score: `${liveHomeScore}-${liveAwayScore}`,
        homeXg: liveStats?.homeXg,
        awayXg: liveStats?.awayXg,
        homeShots: liveStats?.homeShots,
        awayShots: liveStats?.awayShots,
        homeShotsOnTarget: liveStats?.homeShotsOnTarget,
        awayShotsOnTarget: liveStats?.awayShotsOnTarget,
        homeRedCards: liveStats?.homeRedCards,
        awayRedCards: liveStats?.awayRedCards,
      },
      "Live xG stats fetched for recalibration",
    );
  }

  const report = scanFixture(
    {
      fixtureId: ev.id,
      league,
      homeTeamId: homeComp.team.id,
      homeTeamName: homeComp.team.displayName,
      awayTeamId: awayComp.team.id,
      awayTeamName: awayComp.team.displayName,
      kickoffUtc: kickoff,
      homeHistory,
      awayHistory,
      homeElo,
      awayElo,
      daysRestHome,
      daysRestAway,
      h2hSample: h2h,
      weather,
      modelState,
      marketOdds: marketOddsForBlend,
      liveState,
    },
    { minEdge: 0, minConvergence: 0, minAssertiveness: 0 },
  );

  const LABELS = ["OURO", "PRATA", "BRONZE"] as const;

  // ── DATA CROSSING (Live + Pre-game): Multi-signal exact score cross-validation
  // Takes the engine's topN (already the output of 80-method cross-model consensus),
  // then further cross-validates each candidate against:
  //   1. Markov remaining-goals projection  → independent stochastic signal
  //   2. Hawkes process momentum projection → temporal goal-clustering signal
  // Scores confirmed by multiple independent signals receive a confidence boost;
  // outlier scores unsupported by secondary signals are gently downweighted.
  // Result: higher-precision exact score picks, especially for live games.
  const crossValidatedTopN = (() => {
    const candidates = report.topN.slice(0, 8); // consider top-8 before final selection

    if (candidates.length === 0) return candidates;

    // Markov expected final score (for live: current score + remaining goals)
    const markovFinalH = report.liveMarkov
      ? Math.round(liveHomeScore + report.liveMarkov.remainingGoalsHome)
      : null;
    const markovFinalA = report.liveMarkov
      ? Math.round(liveAwayScore + report.liveMarkov.remainingGoalsAway)
      : null;

    // Hawkes process projected final score
    const hawkesFinalH = report.hawkesAnalysis?.projectedHome != null
      ? Math.round(report.hawkesAnalysis.projectedHome)
      : null;
    const hawkesFinalA = report.hawkesAnalysis?.projectedAway != null
      ? Math.round(report.hawkesAnalysis.projectedAway)
      : null;

    // Shot-quality / xG expected final (cross-reference: engine already uses it but
    // measuring agreement is an independent signal).
    // For live games: engine topN scores are in final-score space (liveOffset applied in scanner).
    // For pre-game: topN scores are also final-score space (liveOffset = 0).

    const scored = candidates.map((pick) => {
      let bonus = 1.0;
      const { home, away } = pick;

      // Markov agreement: exact match (+18%), ±1 goal total (+8%)
      if (markovFinalH !== null && markovFinalA !== null) {
        const dist = Math.abs(home - markovFinalH) + Math.abs(away - markovFinalA);
        if (dist === 0) bonus += 0.18;
        else if (dist === 1) bonus += 0.08;
        else if (dist === 2) bonus += 0.03;
      }

      // Hawkes momentum agreement: exact (+12%), ±1 goal total (+5%)
      if (hawkesFinalH !== null && hawkesFinalA !== null) {
        const dist = Math.abs(home - hawkesFinalH) + Math.abs(away - hawkesFinalA);
        if (dist === 0) bonus += 0.12;
        else if (dist === 1) bonus += 0.05;
      }

      // Triple-signal convergence bonus: all three (engine primary + Markov + Hawkes) agree
      if (
        markovFinalH !== null && hawkesFinalH !== null &&
        home === markovFinalH && away === markovFinalA &&
        home === hawkesFinalH && away === hawkesFinalA
      ) {
        bonus += 0.10; // extra "triple lock" amplification
      }

      // Score feasibility for live games: penalise scores below current scoreline
      // (should be impossible after validateLiveTop3, but extra safety)
      if (isLive && (home < liveHomeScore || away < liveAwayScore)) {
        bonus *= 0.01;
      }

      return { ...pick, prob: pick.prob * bonus };
    });

    // Renormalize among candidates
    const total = scored.reduce((s, c) => s + c.prob, 0);
    if (total > 0) for (const s of scored) s.prob /= total;
    scored.sort((x, y) => y.prob - x.prob);
    return scored;
  })();

  const sourceTopN = crossValidatedTopN.length > 0 ? crossValidatedTopN : report.topN;

  const rawTop3: LiveRecalibratePick[] = sourceTopN.slice(0, 3).map((pick, i) => ({
    home: pick.home,
    away: pick.away,
    prob: pick.prob,
    finalProb: pick.prob,
    confidencePct: pick.prob * 100,
    label: LABELS[i] ?? `#${i + 1}`,
  }));

  if (rawTop3.length === 0) {
    rawTop3.push({
      home: report.primary.home,
      away: report.primary.away,
      prob: report.primary.prob,
      finalProb: report.primary.prob,
      confidencePct: report.primary.prob * 100,
      label: "OURO",
    });
  }

  // Safety: ensure all picks are >= current live score
  const top3 = validateLiveTop3(rawTop3, liveHomeScore, liveAwayScore, isLive);

  // ─── Market suggestions ─────────────────────────────────────────────────
  // mcStats are already score-anchored for live games (liveMcStats in scanner.ts).
  // bttsProb from mcStats is the correct score-anchored probability.
  const bttsStructural = (report.scorelinePatterns as any)?.bttsProb ?? report.mcStats.bttsProb;
  const bttsMC         = report.mcStats.bttsProb;

  // For live games: if BTTS is already achieved, bttsProb = 1.0 (from liveMcStats).
  // For pre-game or not-yet-achieved: blend structural + MC.
  const bttsProb = isLive && liveHomeScore > 0 && liveAwayScore > 0
    ? 1.0
    : 0.55 * bttsStructural + 0.45 * bttsMC;

  const overUnderSuggestions = computeOverUnderSuggestions(
    report.mcStats,
    report.topN,
    liveHomeScore,
    liveAwayScore,
    isLive,
  );

  const htFtSuggestions = computeHtFtSuggestions(
    report.topN,
    report.mcStats,
    liveMinute,
    liveHomeScore,
    liveAwayScore,
    isLive,
  );

  const analysisContext = buildContext(
    homeComp.team.displayName,
    awayComp.team.displayName,
    liveMinute,
    liveHomeScore,
    liveAwayScore,
    top3,
    report.assertivenessReal,
    report.ensembleConvergence,
    {
      mcStats: report.mcStats,
      liveMarkov: report.liveMarkov,
      hawkesAnalysis: report.hawkesAnalysis,
      xRayFlags: report.xRayFlags,
      xRayDriver: report.xRayDriver,
      momentumCarry: report.momentumCarry,
      homeForm: report.homeForm,
      awayForm: report.awayForm,
      ensembleConvergence: report.ensembleConvergence,
      zScore: report.zScore,
      tacticalMatchup: report.tacticalMatchup,
      scorelinePatterns: (report as any).scorelinePatterns ?? null,
      bettingMarkets: bettingMarkets ?? null,
      liveContextAnalysis: report.liveContextAnalysis ?? null,
    },
    isLive,
    liveStats,
  );

  return {
    fixtureId,
    homeTeam: homeComp.team.displayName,
    awayTeam: awayComp.team.displayName,
    leagueName: league.name,
    liveMinute: isLive ? liveMinute : 0,
    liveHomeScore,
    liveAwayScore,
    top3,
    assertiveness: report.assertivenessReal,
    convergence: report.ensembleConvergence,
    zScore: report.zScore,
    analysisContext,
    recalibratedAt: new Date().toISOString(),
    bttsProb,
    overUnderSuggestions,
    htFtSuggestions,
    bettingMarkets: bettingMarkets ?? null,
    isLive,
    liveStats: liveStats ?? null,
  };
}
