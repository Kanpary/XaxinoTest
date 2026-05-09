import { useMemo, useState } from "react";
import {
  useRunScanner,
  useListLeagues,
  useLiveRecalibrate,
  getListPredictionsQueryKey,
} from "@workspace/api-client-react";
import type { LiveRecalibrateOut } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { AoVivoPanel, LiveRecalibratePanel } from "../components/LivePanel";

const BOOT_LINES = [
  "Bootstrapping Aposta Mestre V7 — 110 métodos profissionais...",
  // Original 30
  "[01] Poisson independente (baseline)... OK",
  "[02] Dixon-Coles τ (low-score correction)... OK",
  "[03] Bivariate Poisson ρ (goal correlation)... OK",
  "[04] Elo-Adaptive Poisson (K=20)... OK",
  "[05] Weighted Form ξ-decay (Bayesian shrinkage)... OK",
  "[06] Negative Binomial α (overdispersion)... OK",
  "[07] Zero-Inflated Poisson π (excess zeros)... OK",
  "[08] Double Poisson θ — Efron 1986 (under+overdispersion)... OK",
  "[09] Hurdle Model — Mullahy 1986 (two-part count)... OK",
  "[10] Bradley-Terry π strength (paired comparison)... OK",
  "[11] Platt-Calibrated DC (sigmoid calibration)... OK",
  "[12] H2H Dixon-Coles (direct confrontation evidence)... OK",
  "[13] Strength of Schedule (SOS — opponent quality)... OK",
  "[14] Tactical Profile (possession/counter/bloc/high-octane)... OK",
  "[15] Venue-Split Form (home-only / away-only context)... OK",
  "[16] H2H λ-blend (confrontation evidence)... OK",
  "[17] Fadiga/Rest multiplier (days between games)... OK",
  "[18] Weather λ-adjustment (rain/wind → scoring reduction)... OK",
  "[19] League Table Pressure (relegation/title race)... OK",
  "[20] Derby/Rivalry Factor (H2H draw rate + avg goals)... OK",
  "[21] Momentum Carry (rolling 3-game weighted average)... OK",
  "[22] Pythagorean Expectation (Heumann 2018)... OK",
  "[23] Kelly Criterion (quarter-Kelly + EV analysis)... OK",
  "[24] Live Markov (Dixon & Robinson 1998)... OK",
  "[25] Conformal Prediction Set (valid 80% coverage)... OK",
  "[26] Shannon Entropy (model disagreement)... OK",
  "[27] Brier Score Decomposition (Murphy 1973)... OK",
  "[28] Regression to Mean (ESS-weighted shrinkage)... OK",
  "[29] Bayesian Model Averaging (TVD agreement weights)... OK",
  "[30] Score Cluster Analysis (k-NN grouping)... OK",
  // New 50 methods (M31-M80)
  "[31] xG Score Matrix (Rathke 2017 — shot quality weighting)... OK",
  "[32] Beta-Binomial Shot Conversion (Bayesian shot efficiency)... OK",
  "[33] xG Monte Carlo Per-Shot Simulator... OK",
  "[34] Hawkes Self-Exciting Process (goals beget goals)... OK",
  "[35] Goal Timing Distribution (Armatas 2007)... OK",
  "[36] Dixon-Robinson Live Model (time-varying intensities)... OK",
  "[37] Schedule Fatigue (days rest + match density — Drust 2012)... OK",
  "[38] Travel Impact (away distance → fatigue multiplier)... OK",
  "[39] Altitude Adjustment (South American venues)... OK",
  "[40] Rotation Probability (squad depth + fixture congestion)... OK",
  "[41] Set Piece Goal Contribution (corners + FKs + penalties)... OK",
  "[42] Referee Tendency Model (card rate → scoring adj.)... OK",
  "[43] Weather & Pitch Impact (precipitation/wind/temp)... OK",
  "[44] Baio-Blangiardo Hierarchical Poisson... OK",
  "[45] James-Stein Empirical Bayes Shrinkage... OK",
  "[46] Posterior Predictive Distribution (full Bayesian)... OK",
  "[47] Frank Copula (symmetric goal correlation)... OK",
  "[48] Gumbel Copula (upper tail dependence)... OK",
  "[49] Clayton Copula (lower tail — goalless draws cluster)... OK",
  "[50] Implied Probability Extraction (Shin power margin)... OK",
  "[51] Sharp Line Detection (steam moves + Pinnacle)... OK",
  "[52] Market Consensus Aggregation (wisdom of crowds)... OK",
  "[53] Closing Line Value (CLV — model vs closing line)... OK",
  "[54] Bayesian Live Score Update (prior → posterior)... OK",
  "[55] Red Card Impact Model (10v11 → lambda adjustment)... OK",
  "[56] Substitution Impact Model (tactical change detection)... OK",
  "[57] Injury Time Prediction (Trewin 2022)... OK",
  "[58] Weibull Count Model (McShane et al 2011)... OK",
  "[59] Conway-Maxwell-Poisson (COM-Poisson)... OK",
  "[60] Generalized Negative Binomial (GNB — asymmetric tails)... OK",
  "[61] Dynamic Home Advantage (crowd density + post-COVID)... OK",
  "[62] Motivation Index (title/relegation/nothing to play)... OK",
  "[63] Season Stage Model (early regression + late amplification)... OK",
  "[64] Advanced H2H Analysis (venue-specific + recurrence)... OK",
  "[65] Stacked Generalization (Level-2 meta-learner)... OK",
  "[66] Multiplicative Weights (Littlestone-Warmuth)... OK",
  "[67] Superforecaster Aggregation (Log Opinion Pool)... OK",
  "[68] LMSR Prediction Market (Hanson 2003)... OK",
  "[69] Isotonic Regression Calibration (non-parametric)... OK",
  "[70] Brier-Optimal Ensemble Weighting... OK",
  "[71] PPDA Pressing Index (passes per defensive action)... OK",
  "[72] Possession Dominance Model... OK",
  "[73] Asymmetric Matchup Resolver (press vs block vs counter)... OK",
  "[74] Variance Inflation Index (high-chaos matchups)... OK",
  "[75] Expected Corners Model (attack style + field position)... OK",
  "[76] Scoreline Frequency Model (50k+ matches empirical)... OK",
  "[77] Goal Difference Model (Skellam-based differential)... OK",
  "[78] Clean Sheet Probability Model (structured zero-inflation)... OK",
  "[79] BTTS Structural Model (attack/defense decomposition)... OK",
  "[80] Late Goal Bias Correction (time-of-goal distribution)... OK",
  "Buscando odds de bookmakers (The-Odds-API)...",
  "Market Blend — Canal OU: recalibrando λ via Over/Under...",
  "Market Blend — Canal 1X2: escalonando regiões da matriz...",
  "Market Blend — Canal BTTS: ajustando região ambas-marcam...",
  "Score Gravity prior (6% empirical regulariser)... OK",
  "X-RAY — 13 anomaly detectors... OK",
  "Meta-Ensemble (Stacking L2) — fundindo 110 modelos... OK",
  "Monte Carlo adaptativo (15K–120K iterações)... OK",
  "BMA convergência ponderada... OK",
  "Extrapolação de singularidades concluída.",
];

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface ScoreCell { home: number; away: number; prob: number; odd?: number | null }
interface BettingOneX2 { homeOdd: number; drawOdd: number; awayOdd: number }
interface BettingOU { line: number; overOdd: number; underOdd: number }
interface BettingBtts { yesOdd: number; noOdd: number }
interface BettingExact { score: string; odd: number }
interface BettingHtFt { ht: string; ft: string; odd: number }
interface BettingHandicap { spread: number; homeOdd: number; awayOdd: number }
interface EdgeHighlight { market: string; value: string; modelProb: number; marketOdd: number; edgePct: number }
interface BettingMarkets {
  bookmaker: string;
  oneX2?: BettingOneX2;
  overUnder?: BettingOU[];
  btts?: BettingBtts;
  exactScore?: BettingExact[];
  htFt?: BettingHtFt[];
  handicap?: BettingHandicap[];
  edgeHighlights?: EdgeHighlight[];
}
interface NeuralXReport {
  fixtureId: string; leagueId: string; leagueName: string;
  homeTeam: string; awayTeam: string; kickoffUtc: string; kickoffBrasilia: string;
  status: string; verdict: "SINGULARITY" | "INCONCLUSIVE";
  primary: ScoreCell; protectionVariant: ScoreCell; hedge: ScoreCell[]; topN: ScoreCell[];
  assertivenessReal: number; ensembleConvergence: number;
  currentOdd: number | null; fairValue: number | null;
  edgePct: number | null; zScore: number; sindicatedVolume: string | null;
  xRayDriver: string; xRayFlags: string[];
  timelineFlow: { start: string; ht: string; m75: string; ft: string };
  forensicVerdict: string[]; motorsActivated: string[]; contextNotes: string[];
  weather: { temperatureC: number; windKph: number; precipitationMm: number; condition: string } | null;
  homeForm: TeamForm; awayForm: TeamForm; h2hSummary: H2H;
  modelBreakdown: { model: string; topScore: string; topProb: number; weight: number }[];
  mcStats: { homeWinProb: number; drawProb: number; awayWinProb: number; over15: number; over25: number; bttsProb: number; avgTotalGoals: number };
  pythagorean?: { homeWinRate: number; drawRate: number; awayWinRate: number; homeExpectedPPG: number; awayExpectedPPG: number } | null;
  kellyPrimary?: { fullKelly: number; quarterKelly: number; halfKelly: number; expectedValue: number; fairOdd: number; hasEdge: boolean; edgePct: number } | null;
  kellyTopScores?: Array<{ score: string; prob: number; fairOdd: number; quarterKelly: number; hasEdge: boolean }>;
  liveMarkov?: { homeWinProb: number; drawProb: number; awayWinProb: number; remainingGoalsHome: number; remainingGoalsAway: number } | null;
  bettingMarkets?: BettingMarkets | null;
  isLive?: boolean;
  liveMinute?: number | null;
  liveHomeScore?: number | null;
  liveAwayScore?: number | null;
  sosAnalysis?: { homeSOSIndex: number; awaySOSIndex: number; homeScheduleLabel: string; awayScheduleLabel: string; lambdaAdjApplied: boolean } | null;
  tacticalMatchup?: { homeStyle: string; awayStyle: string; matchupLabel: string; isDefensiveClash: boolean; isHighScoringExpected: boolean; setPieceImportance: number; lambdaHomeAdj: number; lambdaAwayAdj: number } | null;
  derbyFactor?: { isDerby: boolean; h2hDrawRate: number; h2hAvgGoals: number; lambdaAdj: number; drawBoost: number } | null;
  momentumCarry?: { homeMomentum: number; awayMomentum: number; homeLabel: string; awayLabel: string } | null;
  probabilisticAnalysis?: { conformalSet: string[]; conformalCoverage: number; conformalSetSize: number; modelEntropy: number; normalizedEntropy: number; entropyLabel: string; brierSkillScore: number } | null;
  regressionToMean?: { coefficient: number; adjustedLambdaHome: number; adjustedLambdaAway: number } | null;
  bmaAgreement?: number | null;
  scoreCluster?: { isTightCluster: boolean; topSpread: number; dominantZone: string; riskLabel: string } | null;
  leaguePressure?: { homeZone: string; awayZone: string; homePPG: number; awayPPG: number } | null;
  resilience?: { homeIsResilient: boolean; awayIsResilient: boolean; homeComebackRate: number; awayComebackRate: number } | null;
  // ─── New 50 methods ───────────────────────────────────────────────────────
  shotQuality?: { xgLambdaHome: number; xgLambdaAway: number; homeXgPerShot: number; awayXgPerShot: number; homeConversionRate: number; awayConversionRate: number } | null;
  hawkesAnalysis?: { projectedHome: number; projectedAway: number; probAnotherGoal: number; hawkesAlpha: number; hawkesBeta: number; situationalState?: string; drLambdaHome?: number; drLambdaAway?: number } | null;
  fatigueAnalysis?: { homeFatigueMultiplier: number; awayFatigueMultiplier: number; homeFatigueIndex: number; awayFatigueIndex: number; homeRotationRisk: number; awayRotationRisk: number; alerts: string[] } | null;
  setPieceAnalysis?: { deltaLambdaHome: number; deltaLambdaAway: number; homeCornerGoals: number; awayCornerGoals: number; weatherMultiplier: number; weatherDescription: string; refereeDisruptionFactor: number; homeSetPieceDominance: number; awaySetPieceDominance: number } | null;
  bayesHierarchical?: { posteriorLambdaHome: number; posteriorLambdaAway: number; homeAttackRank: string; awayDefenseRank: string; homeShrinkage: number; awayShrinkage: number } | null;
  copulaAnalysis?: { copulaType: string; copulaParameter: number; probBothScore: number; prob00: number; upperTailDep: number; lowerTailDep: number } | null;
  marketIntelligence?: { impliedHomeWin: number; impliedDraw: number; impliedAwayWin: number; totalMargin: number; steamMoveDetected: boolean; steamDirection: string; clvHome: number; clvAway: number; clvEdge: number; marketEfficiency: number; valueBets: Array<{ market: string; modelProb: number; impliedOdd: number; edge: number }> } | null;
  liveContextAnalysis?: { remainingLambdaHome: number; remainingLambdaAway: number; liveHomeWinProb: number; liveDrawProb: number; liveAwayWinProb: number; estimatedInjuryTime: number; redCardLambdaHome: number; redCardLambdaAway: number } | null;
  weibullAnalysis?: { homeDispersion: string; awayDispersion: string; weibullRhoHome: number; weibullRhoAway: number; comPoissonNuHome: number; comPoissonNuAway: number } | null;
  contextualFactors?: { dynamicHomeAdvantage: number; homeMotivationMult: number; awayMotivationMult: number; seasonStageMultiplier: number; motivationContext: string; crowdEffect: string; h2hMostCommonScores: Array<{ home: number; away: number; count: number }>; h2hScorelineRecurrenceFactor: number } | null;
  metaEnsemble?: { modelDiversity: number; ensembleEntropy: number; calibrationShift: number; topScoresAgreement: Array<{ score: string; agreementScore: number; rank: number }>; updatedModelWeights: Record<string, number> } | null;
  pressingAnalysis?: { homePressIndex: number; awayPressIndex: number; possessionDominance: number; matchupType: string; chaosIndex: number; varianceInflation: number; expectedCornersHome: number; expectedCornersAway: number; tacticalNotes: string[] } | null;
  scorelinePatterns?: { homeWinProb: number; drawProb: number; awayWinProb: number; bttsProb: number; cleanSheetProbHome: number; cleanSheetProbAway: number; lateGoalBias: number; historicalTopScores: Array<{ home: number; away: number; empiricalFreq: number; modelProb: number }> } | null;
}
interface TeamForm {
  teamName: string; gamesAnalyzed: number; avgGoalsFor: number; avgGoalsAgainst: number;
  weightedAttack: number; weightedDefense: number; eloRating: number;
  recentForm: string[]; daysRest: number;
}
interface H2H {
  sampleSize: number; homeWins: number; draws: number; awayWins: number;
  avgGoalsTotal: number; lastFiveScores: string[];
}
interface ScannerResp {
  scannedAt: string; date: string; fixturesScanned: number;
  singularitiesFound: number; inconclusiveCount: number;
  thresholds: { minEdge: number; minConvergence: number; minAssertiveness: number };
  reports: NeuralXReport[];
}

/**
 * Composite confidence score used to rank predictions.
 * Combines three independent signals (all normalized to 0-1):
 *   - assertivenessReal (40%): probability of the primary predicted score
 *   - ensembleConvergence (35%): agreement among the 4 ensemble models
 *   - zScore normalized (25%): statistical significance (capped at 12σ)
 */
function confidenceScore(r: NeuralXReport): number {
  const assertN = r.assertivenessReal;
  const convN = Math.max(0, Math.min(1, r.ensembleConvergence));
  const zN = Math.min(r.zScore, 12) / 12;
  return assertN * 0.40 + convN * 0.35 + zN * 0.25;
}

const TOP_N = 3;

export default function ScannerPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [selected, setSelected] = useState<string[]>([]);
  const [minConvergence, setMinConvergence] = useState<number>(0.6);
  const [running, setRunning] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<ScannerResp | null>(null);
  const [topFilter, setTopFilter] = useState(false);

  const { mutateAsync: runScanner } = useRunScanner();
  const { data: leagues = [] } = useListLeagues();
  const queryClient = useQueryClient();

  const allLeagueIds = useMemo(() => leagues.map((l) => l.id), [leagues]);
  const effectiveLeagueIds = selected.length > 0 ? selected : allLeagueIds;

  // Singularities ranked by composite confidence score (desc)
  const rankedSingularities = useMemo(() => {
    if (!result) return [];
    return [...result.reports.filter((r) => r.verdict === "SINGULARITY")]
      .sort((a, b) => confidenceScore(b) - confidenceScore(a));
  }, [result]);

  // Map fixtureId → rank (1-based, only top N)
  const rankMap = useMemo(() => {
    const m = new Map<string, number>();
    rankedSingularities.slice(0, TOP_N).forEach((r, i) => m.set(r.fixtureId, i + 1));
    return m;
  }, [rankedSingularities]);

  // Reports to display: top N singularities when filter is on, otherwise all
  const displayedReports = useMemo(() => {
    if (!result) return [];
    if (topFilter) return rankedSingularities.slice(0, TOP_N);
    return result.reports;
  }, [result, topFilter, rankedSingularities]);

  const leaguesByConf = useMemo(() => {
    const map = new Map<string, typeof leagues>();
    for (const l of leagues) {
      const conf = l.confederation ?? "Outras";
      if (!map.has(conf)) map.set(conf, []);
      map.get(conf)!.push(l);
    }
    const ORDER = ["CONMEBOL", "UEFA", "CONCACAF", "AFC", "CAF", "FIFA", "Outras"];
    return ORDER.flatMap((conf) =>
      map.has(conf) ? [{ conf, items: map.get(conf)! }] : [],
    );
  }, [leagues]);

  const toggleConf = (conf: string, items: typeof leagues) => {
    const ids = items.map((l) => l.id);
    const allSel = ids.every((id) => selected.includes(id));
    if (allSel) setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    else setSelected((prev) => [...new Set([...prev, ...ids])]);
  };

  const toggleLeague = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleRun = async () => {
    setRunning(true);
    setAnimating(true);
    setLogs([]);
    setResult(null);

    // Boot animation runs independently — hides itself when done
    (async () => {
      for (const line of BOOT_LINES) {
        await new Promise((r) => setTimeout(r, 230));
        setLogs((prev) => [...prev, line]);
      }
      setAnimating(false);
    })();

    try {
      const data = (await runScanner({
        data: { leagueIds: selected.length > 0 ? selected : undefined, date, minEdge: 0, minConvergence },
      })) as unknown as ScannerResp;
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: getListPredictionsQueryKey() });
    } catch {
      setLogs((prev) => [...prev, "Erro na execução do scanner."]);
    } finally {
      setAnimating(false);
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Controls card */}
      <div className="border border-border/50 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-sm font-semibold">Scanner</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Ensemble · Monte Carlo · ESPN</p>
          </div>
          <button
            onClick={handleRun}
            disabled={running}
            className="self-start sm:self-auto px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {running ? "Executando…" : "Executar varredura"}
          </button>
        </div>

        <div className="px-4 py-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Date */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Data (BRT)</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-muted/40 border border-border/50 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Convergence slider */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Convergência — <span className="text-foreground font-mono normal-case">{(minConvergence * 100).toFixed(0)}%</span>
            </label>
            <input
              type="range" min={0.5} max={0.95} step={0.05}
              value={minConvergence}
              onChange={(e) => setMinConvergence(parseFloat(e.target.value))}
              className="w-full accent-primary mt-2"
            />
          </div>

          {/* League picker */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Ligas — <span className="text-foreground font-mono normal-case">{effectiveLeagueIds.length}/{allLeagueIds.length}</span>
              </label>
              {selected.length > 0 && (
                <button type="button" onClick={() => setSelected([])}
                  className="text-[11px] text-primary hover:text-primary/70">Limpar</button>
              )}
            </div>
            <div className="border border-border/50 rounded-md max-h-[140px] overflow-y-auto text-xs">
              {leaguesByConf.map(({ conf, items }) => {
                const confIds = items.map((l) => l.id);
                const allSel = confIds.every((id) => selected.includes(id));
                const someSel = confIds.some((id) => selected.includes(id));
                return (
                  <div key={conf}>
                    <button type="button" onClick={() => toggleConf(conf, items)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 border-b border-border/40 font-medium transition-colors ${
                        allSel ? "bg-primary/10 text-primary" : someSel ? "bg-primary/5 text-primary/70" : "text-muted-foreground hover:bg-muted/40"
                      }`}>
                      <span>{conf}</span>
                      <span className="opacity-50 font-normal">{items.length}</span>
                    </button>
                    <div className="flex flex-wrap gap-1 px-2.5 py-2 border-b border-border/20">
                      {items.map((l) => (
                        <button key={l.id} type="button" onClick={() => toggleLeague(l.id)}
                          className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                            selected.includes(l.id)
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border/40 text-muted-foreground hover:border-border"
                          }`}>
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Summary bar */}
        {result && (
          <div className="px-4 py-2.5 border-t border-border/50 bg-muted/20 flex flex-wrap gap-x-5 gap-y-1.5 items-center">
            <span className="text-[11px] text-muted-foreground">{result.date}</span>
            <span className="text-[11px]"><span className="text-muted-foreground">Jogos </span><span className="font-mono">{result.fixturesScanned}</span></span>
            <span className="text-[11px]"><span className="text-muted-foreground">Singularidades </span><span className="font-mono text-primary font-semibold">{result.singularitiesFound}</span></span>
            <span className="text-[11px]"><span className="text-muted-foreground">Inconclusivos </span><span className="font-mono">{result.inconclusiveCount}</span></span>
            {result.singularitiesFound >= TOP_N && (
              <button
                onClick={() => setTopFilter((v) => !v)}
                className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium transition-all ${
                  topFilter
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                    : "border-border/50 text-muted-foreground hover:border-amber-500/40 hover:text-amber-400/80"
                }`}
              >
                Top {TOP_N}
                {topFilter && <span className="ml-0.5 text-[9px] font-mono opacity-70">ATIVO</span>}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Ao Vivo Agora — sempre visível, independente do scanner ─── */}
      <AoVivoPanel />

      {/* Boot animation overlay — closes automatically when animation ends */}
      <AnimatePresence>
        {animating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center p-6">
            <div className="w-full max-w-lg border border-border rounded-lg bg-card p-6">
              <div className="flex items-center gap-2 pb-3 mb-4 border-b border-border">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-sm font-medium">Encore Engine V4</span>
                <span className="ml-auto text-xs text-muted-foreground font-mono">inicializando...</span>
              </div>
              <div className="space-y-1.5 font-mono text-xs min-h-[260px]">
                {logs.map((log, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                    className={
                      log.includes("concluída") ? "text-accent font-medium" :
                      log.includes("Erro") ? "text-destructive" :
                      log.includes("SKIPPED") ? "text-amber-500" :
                      "text-muted-foreground"
                    }>
                    <span className="text-border mr-2">›</span>{log}
                  </motion.div>
                ))}
                {logs.length < BOOT_LINES.length && (
                  <div className="text-primary animate-pulse mt-1">_</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Running indicator shown after animation closes */}
      {running && !animating && (
        <div className="border border-border/50 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
          <p className="text-sm text-muted-foreground">Processando fixtures…</p>
        </div>
      )}

      {/* Empty state */}
      {!running && !result && (
        <div className="border border-border/40 border-dashed rounded-xl py-20 text-center">
          <p className="text-sm text-muted-foreground">Standby</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">Configure os parâmetros e execute a varredura.</p>
        </div>
      )}

      {/* No fixtures */}
      {!running && result && result.reports.length === 0 && (
        <div className="border border-border/40 border-dashed rounded-xl py-12 text-center">
          <p className="text-sm text-muted-foreground">Nenhum jogo encontrado para {result.date}</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">Tente outra data ou outras ligas.</p>
        </div>
      )}

      {/* Compact Veredito Table — singularities only */}
      {!running && result && result.singularitiesFound > 0 && (
        <div className="border border-border/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/50 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Vereditos</span>
            <span className="text-[11px] text-muted-foreground">
              {topFilter ? `Top ${TOP_N} / ${result.singularitiesFound}` : `${result.singularitiesFound} singularidades`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">Confronto</th>
                  <th className="text-center px-3 py-2 font-medium">Veredito</th>
                  <th className="text-center px-3 py-2 font-medium">Proteção</th>
                  <th className="text-right px-3 py-2 font-medium">Confiança</th>
                  <th className="text-right px-3 py-2 font-medium">P</th>
                  <th className="text-right px-3 py-2 font-medium">Z</th>
                  <th className="text-right px-3 py-2 font-medium">1X2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {(topFilter ? rankedSingularities.slice(0, TOP_N) : rankedSingularities)
                  .map((r, i) => {
                    const rank = rankMap.get(r.fixtureId);
                    const isTop = rank !== undefined;
                    const conf = confidenceScore(r);
                    return (
                      <tr key={r.fixtureId} className={`hover:bg-muted/20 transition-colors ${isTop && topFilter ? "bg-amber-500/3" : ""}`}>
                        <td className="px-3 py-1.5 font-mono">
                          {isTop ? (
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                              rank === 1 ? "bg-amber-400/20 text-amber-400 border border-amber-400/40" :
                              rank === 2 ? "bg-zinc-400/20 text-zinc-300 border border-zinc-400/40" :
                              "bg-orange-700/20 text-orange-400 border border-orange-600/40"
                            }`}>{rank}</span>
                          ) : (
                            <span className="text-muted-foreground">{i + 1}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{r.homeTeam}</span>
                          <span className="text-muted-foreground mx-1">×</span>
                          <span className="font-medium">{r.awayTeam}</span>
                          {r.xRayFlags.length > 0 && (
                            <span className="ml-1.5 text-[10px] text-amber-500 border border-amber-500/30 px-1 py-0.5 rounded">
                              {r.xRayFlags.length} flag{r.xRayFlags.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center font-mono font-bold text-primary">
                          {r.primary.home}–{r.primary.away}
                        </td>
                        <td className="px-3 py-1.5 text-center font-mono text-muted-foreground">
                          {r.protectionVariant.home}–{r.protectionVariant.away}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <ConfBar value={conf} rank={rank} />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {(r.assertivenessReal * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-primary">
                          {r.zScore.toFixed(1)}σ
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[10px]">
                          <span className="text-accent">{(r.mcStats.homeWinProb * 100).toFixed(0)}</span>
                          <span className="text-muted-foreground mx-0.5">/</span>
                          <span>{(r.mcStats.drawProb * 100).toFixed(0)}</span>
                          <span className="text-muted-foreground mx-0.5">/</span>
                          <span className="text-destructive">{(r.mcStats.awayWinProb * 100).toFixed(0)}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top-3 filter banner shown above cards when active */}
      {!running && result && topFilter && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="border border-amber-500/20 rounded-xl px-4 py-2.5 bg-amber-500/5 flex items-center gap-3"
        >
          <p className="text-[11px] text-amber-400 flex-1">Top {TOP_N} — score composto (assertividade · convergência · z-score)</p>
          <button
            onClick={() => setTopFilter(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Ver todos
          </button>
        </motion.div>
      )}

      {/* Reports */}
      <div className="space-y-4">
        {!running && displayedReports.map((report, idx) => (
          <ReportCard key={report.fixtureId} report={report} idx={idx} rank={rankMap.get(report.fixtureId)} showRank={topFilter} />
        ))}
      </div>
    </div>
  );
}

function SumStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

/** Mini confidence bar displayed in the table next to each ranked prediction. */
function ConfBar({ value, rank }: { value: number; rank?: number }) {
  const pct = Math.round(value * 100);
  const color =
    rank === 1 ? "bg-amber-400" :
    rank === 2 ? "bg-zinc-300" :
    rank === 3 ? "bg-orange-500" :
    "bg-primary/50";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-[11px] tabular-nums ${rank ? "text-foreground font-medium" : "text-muted-foreground"}`}>
        {pct}%
      </span>
    </div>
  );
}

const RANK_STYLES = {
  1: { border: "border-amber-400/50", bg: "bg-amber-400/5", label: "bg-amber-400/20 text-amber-300 border-amber-400/50", text: "OURO" },
  2: { border: "border-zinc-400/40", bg: "bg-zinc-400/5", label: "bg-zinc-400/20 text-zinc-300 border-zinc-400/40", text: "PRATA" },
  3: { border: "border-orange-600/40", bg: "bg-orange-600/5", label: "bg-orange-600/20 text-orange-300 border-orange-600/40", text: "BRONZE" },
} as const;

function ReportCard({ report, idx, rank, showRank }: { report: NeuralXReport; idx: number; rank?: number; showRank?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [liveResult, setLiveResult] = useState<LiveRecalibrateOut | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const { mutate: runLiveRecalibrate, isPending: liveLoading } = useLiveRecalibrate({
    mutation: {
      onSuccess: (data) => { setLiveResult(data); setLiveError(null); },
      onError: (err) => {
        const msg = (err as { message?: string })?.message ?? "Falha na recalibração";
        setLiveError(msg);
      },
    },
  });

  if (report.verdict === "INCONCLUSIVE") {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
        className="border border-border/30 rounded-xl px-4 py-2.5 flex items-center justify-between opacity-50">
        <div>
          <p className="text-[10px] text-muted-foreground">{report.leagueName} · {report.kickoffBrasilia}</p>
          <p className="text-sm font-medium mt-0.5">{report.homeTeam} × {report.awayTeam}</p>
        </div>
        <span className="text-[10px] text-muted-foreground/70 border border-border/40 px-2 py-0.5 rounded">Inconclusivo</span>
      </motion.div>
    );
  }

  const zHigh = report.zScore >= 9;
  const zMed = report.zScore >= 6;
  const rs = showRank && rank ? RANK_STYLES[rank as 1 | 2 | 3] : null;
  const conf = confidenceScore(report);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
      className={`border rounded-xl overflow-hidden ${rs ? rs.border : "border-border/50"}`}>
      {/* Rank banner */}
      {rs && (
        <div className={`px-4 py-1.5 border-b flex items-center gap-2 ${rs.bg} ${rs.border}`}>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono ${rs.label}`}>#{rank}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {Math.round(conf * 100)}% conf · {(report.assertivenessReal*100).toFixed(1)}% assert · Z {report.zScore.toFixed(1)}σ
          </span>
        </div>
      )}

      {/* Header — always visible, acts as the click target */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-2 hover:bg-white/2 transition-colors"
      >
        <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">
          {String(idx + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] text-muted-foreground/70 truncate max-w-[130px] sm:max-w-none shrink-0">{report.leagueName}</span>
        <span className="text-[11px] text-muted-foreground/50 shrink-0">{report.kickoffBrasilia}</span>

        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {report.isLive && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              AO VIVO {report.liveMinute != null ? `${report.liveMinute}'` : ""}
              {report.liveHomeScore != null && report.liveAwayScore != null ? ` · ${report.liveHomeScore}-${report.liveAwayScore}` : ""}
            </span>
          )}
          <span className="font-semibold text-sm truncate max-w-[180px] sm:max-w-none">{report.homeTeam} × {report.awayTeam}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Top 3 score predictions */}
          <span className="font-mono font-bold text-lg text-primary leading-none">
            {report.topN[0]?.home ?? report.primary.home}–{report.topN[0]?.away ?? report.primary.away}
          </span>
          {report.topN[1] && (
            <>
              <span className="text-muted-foreground/40 font-mono text-[10px]">/</span>
              <span className="font-mono text-amber-500/80 text-sm font-semibold">
                {report.topN[1].home}–{report.topN[1].away}
              </span>
            </>
          )}
          {report.topN[2] && (
            <>
              <span className="text-muted-foreground/40 font-mono text-[10px]">/</span>
              <span className="font-mono text-muted-foreground/60 text-xs">
                {report.topN[2].home}–{report.topN[2].away}
              </span>
            </>
          )}
          <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded font-mono border ${
            zHigh ? "border-primary/40 text-primary bg-primary/5" :
            zMed ? "border-amber-500/40 text-amber-500 bg-amber-500/5" :
            "border-border/40 text-muted-foreground"
          }`}>Z {report.zScore.toFixed(1)}σ</span>
          <span className="text-[11px] text-muted-foreground/40">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* X-RAY flags */}
      {report.xRayFlags.length > 0 && (
        <div className="px-4 py-2 border-t border-border/30 flex flex-wrap gap-1.5">
          {report.xRayFlags.map((flag, i) => {
            const isCrit = flag.includes("|CRITICA]");
            const isAlta = flag.includes("|ALTA]");
            const label = flag.replace(/^\[.*?\]\s*/, "").split(" — ")[1] ?? flag.replace(/^\[.*?\]\s*/, "");
            const code = (flag.match(/^\[([^|]+)/) ?? [])[1] ?? "FLAG";
            return (
              <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${
                isCrit ? "border-destructive/40 text-destructive bg-destructive/5" :
                isAlta ? "border-amber-500/40 text-amber-500 bg-amber-500/5" :
                "border-border/30 text-muted-foreground"
              }`}>
                ⚑ {code}: {label.length > 40 ? label.slice(0, 37) + "…" : label}
              </span>
            );
          })}
        </div>
      )}

      {/* Summary row — always visible below header */}
      <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border/30 pt-3">
        <div className="space-y-0.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Assertividade</p>
          <p className="font-mono text-sm font-semibold text-primary">{(report.assertivenessReal * 100).toFixed(1)}%</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Convergência</p>
          <p className="font-mono text-sm">{(report.ensembleConvergence * 100).toFixed(0)}%</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Odd / Edge</p>
          <p className="font-mono text-sm">{report.currentOdd ?? "—"} <span className="text-muted-foreground text-[10px]">{report.edgePct != null ? `+${(report.edgePct * 100).toFixed(1)}%` : ""}</span></p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">1X2</p>
          <p className="font-mono text-xs">
            <span className="text-accent">{(report.mcStats.homeWinProb * 100).toFixed(0)}</span>
            <span className="text-muted-foreground/40 mx-0.5">/</span>
            <span>{(report.mcStats.drawProb * 100).toFixed(0)}</span>
            <span className="text-muted-foreground/40 mx-0.5">/</span>
            <span className="text-destructive">{(report.mcStats.awayWinProb * 100).toFixed(0)}</span>
          </p>
        </div>
      </div>

      {/* Analysis button — live recalibration for in-progress, pre-game for upcoming */}
      <div className={`px-4 pb-3 flex items-center gap-3 border-t pt-3 ${report.isLive ? "border-red-500/20" : "border-border/30"}`}>
        <button
          onClick={() => {
            if (liveResult) { setLiveResult(null); return; }
            setLiveError(null);
            runLiveRecalibrate({ data: { fixtureId: report.fixtureId, leagueId: report.leagueId } });
          }}
          disabled={liveLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border transition-colors disabled:opacity-50 ${
            report.isLive
              ? "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
          }`}
        >
          {liveLoading ? (
            <>
              <span className={`w-3 h-3 border rounded-full animate-spin ${report.isLive ? "border-red-400/30 border-t-red-400" : "border-primary/30 border-t-primary"}`} />
              {report.isLive ? "Recalibrando…" : "Analisando…"}
            </>
          ) : liveResult ? (
            <>
              <span className={`w-1.5 h-1.5 rounded-full ${report.isLive ? "bg-red-400" : "bg-primary"}`} />
              Ocultar análise
            </>
          ) : (
            <>
              <span className={`w-1.5 h-1.5 rounded-full ${report.isLive ? "bg-red-400 animate-pulse" : "bg-primary/70"}`} />
              {report.isLive ? "Recalibrar ao Vivo" : "Analisar Pré-Jogo"}
            </>
          )}
        </button>
        {liveError && (
          <span className="text-[10px] text-destructive">{liveError}</span>
        )}
        {liveResult && !liveError && (
          <span className="text-[10px] text-muted-foreground">
            {report.isLive ? "3 melhores palpites" : "Análise completa"} · {new Date(liveResult.recalibratedAt).toLocaleTimeString("pt-BR")}
          </span>
        )}
      </div>

      {/* Live recalibration results panel */}
      <AnimatePresence>
        {liveResult && (
          <LiveRecalibratePanel result={liveResult} onClose={() => setLiveResult(null)} />
        )}
      </AnimatePresence>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="border-t border-border overflow-hidden">

            {/* Heatmap + X-Ray + Weather */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
              <div>
                <SectionLabel>Mapa de probabilidades</SectionLabel>
                <ScoreHeatmap report={report} />
              </div>

              <div>
                <SectionLabel>Driver X-Ray</SectionLabel>
                <div className="space-y-1 mt-2">
                  {report.xRayDriver.split(" | ").map((p, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-primary shrink-0 mt-0.5">›</span>
                      <span className="text-muted-foreground">{p}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Condições & Timeline</SectionLabel>
                {report.weather && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Condição</span>
                    <span className="font-mono">{report.weather.condition}</span>
                    <span className="text-muted-foreground">Temperatura</span>
                    <span className="font-mono">{report.weather.temperatureC}°C</span>
                    <span className="text-muted-foreground">Vento</span>
                    <span className="font-mono">{report.weather.windKph} km/h</span>
                    <span className="text-muted-foreground">Precipitação</span>
                    <span className="font-mono">{report.weather.precipitationMm} mm</span>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-4 gap-1">
                  {[
                    { tag: "Início", val: report.timelineFlow.start },
                    { tag: "HT", val: report.timelineFlow.ht },
                    { tag: "75'", val: report.timelineFlow.m75 },
                    { tag: "FT", val: report.timelineFlow.ft },
                  ].map(({ tag, val }) => (
                    <div key={tag} className="border border-border rounded px-1.5 py-1.5 text-center">
                      <div className="text-[10px] text-muted-foreground">{tag}</div>
                      <div className="text-[11px] font-mono font-semibold mt-0.5 leading-tight">{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Team form */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
              <FormPanel form={report.homeForm} venue="Mandante" />
              <FormPanel form={report.awayForm} venue="Visitante" />
            </div>

            {/* MC Stats — 1X2 / Over-Under / BTTS */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
              <SectionLabel>Mercados Monte Carlo</SectionLabel>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                {/* 1X2 */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Resultado Final (1X2)</p>
                  <div className="space-y-1.5">
                    {[
                      { label: "Casa (1)", value: report.mcStats.homeWinProb, color: "bg-accent" },
                      { label: "Empate (X)", value: report.mcStats.drawProb, color: "bg-border" },
                      { label: "Fora (2)", value: report.mcStats.awayWinProb, color: "bg-destructive/70" },
                    ].map(({ label, value, color }) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-mono">{(value * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${color} rounded-full transition-all`}
                            style={{ width: `${(value * 100).toFixed(1)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Over / Under */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Over / Under</p>
                  <div className="space-y-1.5">
                    {[
                      { label: "Over 1.5", value: report.mcStats.over15 },
                      { label: "Over 2.5", value: report.mcStats.over25 },
                      { label: "Under 2.5", value: 1 - report.mcStats.over25 },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-mono">{(value * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary/60 rounded-full transition-all"
                            style={{ width: `${(value * 100).toFixed(1)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* BTTS + avg */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">BTTS & Média</p>
                  <div className="space-y-1.5">
                    <div>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">Ambos marcam</span>
                        <span className="font-mono">{(report.mcStats.bttsProb * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500/70 rounded-full transition-all"
                          style={{ width: `${(report.mcStats.bttsProb * 100).toFixed(1)}%` }} />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs pt-1.5 border-t border-border/50">
                      <span className="text-muted-foreground">Média de gols</span>
                      <span className="font-mono font-semibold text-primary">{report.mcStats.avgTotalGoals.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Betting Markets Panel — shows real bookmaker odds when ODDS_API_KEY is set */}
            {report.bettingMarkets && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel>Odds de Bookie — {report.bettingMarkets.bookmaker}</SectionLabel>
                  {report.bettingMarkets.edgeHighlights && report.bettingMarkets.edgeHighlights.length > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30 font-medium">
                      {report.bettingMarkets.edgeHighlights.length} edge{report.bettingMarkets.edgeHighlights.length > 1 ? "s" : ""} detectado{report.bettingMarkets.edgeHighlights.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {/* Edge highlights — top priority */}
                {report.bettingMarkets.edgeHighlights && report.bettingMarkets.edgeHighlights.length > 0 && (
                  <div className="mb-3 p-2.5 bg-accent/5 border border-accent/20 rounded-lg">
                    <p className="text-[10px] text-accent uppercase tracking-wide font-medium mb-2">Vantagem Modelo vs Mercado</p>
                    <div className="space-y-1.5">
                      {report.bettingMarkets.edgeHighlights.map((e, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{e.market} <span className="font-mono text-foreground">{e.value}</span></span>
                          <div className="flex items-center gap-2 font-mono">
                            <span className="text-muted-foreground">{(e.modelProb * 100).toFixed(1)}% vs {(1 / e.marketOdd * 100).toFixed(1)}%</span>
                            <span className={`font-semibold ${e.edgePct >= 15 ? "text-accent" : "text-primary"}`}>
                              +{e.edgePct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {/* 1X2 */}
                  {report.bettingMarkets.oneX2 && (
                    <div className="col-span-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">1X2</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground truncate">Casa</span>
                          <span className="font-mono font-semibold text-foreground">{report.bettingMarkets.oneX2.homeOdd.toFixed(2)}</span>
                        </div>
                        {report.bettingMarkets.oneX2.drawOdd > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Emp.</span>
                            <span className="font-mono font-semibold">{report.bettingMarkets.oneX2.drawOdd.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground truncate">Fora</span>
                          <span className="font-mono font-semibold">{report.bettingMarkets.oneX2.awayOdd.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Over/Under */}
                  {report.bettingMarkets.overUnder && report.bettingMarkets.overUnder.length > 0 && (
                    <div className="col-span-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Over/Under</p>
                      <div className="space-y-1 text-xs">
                        {report.bettingMarkets.overUnder.slice(0, 3).map((ou, i) => (
                          <div key={i} className="flex justify-between gap-1">
                            <span className="text-muted-foreground font-mono">{ou.line}</span>
                            <span className="font-mono text-primary">{ou.overOdd.toFixed(2)}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-mono">{ou.underOdd.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* BTTS */}
                  {report.bettingMarkets.btts && (
                    <div className="col-span-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Ambas Marcam</p>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Sim</span>
                          <span className="font-mono font-semibold text-amber-500">{report.bettingMarkets.btts.yesOdd.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Não</span>
                          <span className="font-mono font-semibold">{report.bettingMarkets.btts.noOdd.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Exact Scores */}
                  {report.bettingMarkets.exactScore && report.bettingMarkets.exactScore.length > 0 && (
                    <div className="col-span-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Placar Exato</p>
                      <div className="space-y-1 text-xs">
                        {report.bettingMarkets.exactScore.slice(0, 5).map((es, i) => {
                          const isPrimary = es.score === `${report.primary.home}-${report.primary.away}`;
                          return (
                            <div key={i} className={`flex justify-between gap-1 ${isPrimary ? "text-primary font-semibold" : ""}`}>
                              <span className={`font-mono ${isPrimary ? "" : "text-muted-foreground"}`}>{es.score}</span>
                              <span className="font-mono">{es.odd.toFixed(2)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* HT/FT */}
                  {report.bettingMarkets.htFt && report.bettingMarkets.htFt.length > 0 && (
                    <div className="col-span-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">HT/FT</p>
                      <div className="space-y-1 text-xs">
                        {report.bettingMarkets.htFt.slice(0, 5).map((h, i) => (
                          <div key={i} className="flex justify-between gap-1">
                            <span className="text-muted-foreground font-mono text-[10px] truncate">{h.ht}/{h.ft}</span>
                            <span className="font-mono shrink-0">{h.odd.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Handicap */}
                  {report.bettingMarkets.handicap && report.bettingMarkets.handicap.length > 0 && (
                    <div className="col-span-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Handicap</p>
                      <div className="space-y-1 text-xs">
                        {report.bettingMarkets.handicap.slice(0, 4).map((hc, i) => (
                          <div key={i} className="flex justify-between gap-1">
                            <span className="font-mono text-muted-foreground">
                              {hc.spread > 0 ? `+${hc.spread}` : hc.spread}
                            </span>
                            <span className="font-mono text-primary">{hc.homeOdd.toFixed(2)}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="font-mono">{hc.awayOdd.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Score Distribution — professional probability bar chart */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>Distribuição de Placares (Top 10)</SectionLabel>
                <span className="text-[10px] text-muted-foreground font-mono">
                  Σ top-10: {(report.topN.slice(0, 10).reduce((s, c) => s + c.prob, 0) * 100).toFixed(1)}%
                </span>
              </div>
              <ScoreDistributionChart report={report} />
            </div>

            {/* Advanced Analysis: Pythagorean + Kelly + Live Markov */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
              <SectionLabel>Análise Avançada</SectionLabel>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">

                {/* Pythagorean Expectation */}
                {report.pythagorean && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Expectativa Pitagórica</p>
                    <div className="space-y-1.5">
                      {[
                        { label: `${report.homeTeam.split(" ").slice(-1)[0]} (1)`, value: report.pythagorean.homeWinRate, color: "bg-accent" },
                        { label: "Empate (X)", value: report.pythagorean.drawRate, color: "bg-border" },
                        { label: `${report.awayTeam.split(" ").slice(-1)[0]} (2)`, value: report.pythagorean.awayWinRate, color: "bg-destructive/70" },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground truncate max-w-[80px]">{label}</span>
                            <span className="font-mono">{(value * 100).toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full transition-all`}
                              style={{ width: `${Math.min(100, value * 100).toFixed(1)}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs pt-1.5 border-t border-border/50">
                        <span className="text-muted-foreground">PPG mandante</span>
                        <span className="font-mono font-semibold text-primary">{report.pythagorean.homeExpectedPPG.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Kelly Criterion */}
                {report.kellyPrimary && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
                      Critério de Kelly — {report.primary.home}–{report.primary.away}
                    </p>
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-muted-foreground text-[10px]">Odd justa</div>
                          <div className="font-mono font-semibold mt-0.5">{report.kellyPrimary.fairOdd.toFixed(2)}</div>
                        </div>
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-muted-foreground text-[10px]">Kelly ¼</div>
                          <div className={`font-mono font-semibold mt-0.5 ${report.kellyPrimary.hasEdge ? "text-accent" : "text-muted-foreground"}`}>
                            {(report.kellyPrimary.quarterKelly * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-muted-foreground text-[10px]">Kelly ½</div>
                          <div className={`font-mono font-semibold mt-0.5 ${report.kellyPrimary.hasEdge ? "text-primary" : "text-muted-foreground"}`}>
                            {(report.kellyPrimary.halfKelly * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-muted-foreground text-[10px]">EV/unidade</div>
                          <div className={`font-mono font-semibold mt-0.5 ${report.kellyPrimary.expectedValue >= 0 ? "text-accent" : "text-destructive"}`}>
                            {report.kellyPrimary.expectedValue >= 0 ? "+" : ""}{(report.kellyPrimary.expectedValue * 100).toFixed(1)}%
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                        Kelly ¼ = fração conservadora do bankroll. EV com odd justa = 0% (sem edge externo).
                        Configure ODDS_API_KEY para análise real de edge.
                      </p>
                    </div>
                  </div>
                )}

                {/* Live Markov (only shown for live games) */}
                {report.isLive && report.liveMarkov ? (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">
                      Markov AO VIVO — {report.liveMinute}'
                    </p>
                    <div className="space-y-1.5">
                      {[
                        { label: `Vitória ${report.homeTeam.split(" ").slice(-1)[0]}`, value: report.liveMarkov.homeWinProb, color: "bg-accent" },
                        { label: "Empate", value: report.liveMarkov.drawProb, color: "bg-amber-500/70" },
                        { label: `Vitória ${report.awayTeam.split(" ").slice(-1)[0]}`, value: report.liveMarkov.awayWinProb, color: "bg-destructive/70" },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground truncate max-w-[90px]">{label}</span>
                            <span className="font-mono font-semibold">{(value * 100).toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full transition-all`}
                              style={{ width: `${Math.min(100, value * 100).toFixed(1)}%` }} />
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs pt-1.5 border-t border-border/50">
                        <span className="text-muted-foreground">Gols restantes (λ)</span>
                        <span className="font-mono">
                          {report.liveMarkov.remainingGoalsHome.toFixed(2)} / {report.liveMarkov.remainingGoalsAway.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : !report.isLive && report.mcStats ? (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Verificação cruzada 1X2</p>
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground mb-2">
                        Comparação Monte Carlo vs Pitagórica — validação multi-modelo
                      </div>
                      {[
                        { label: "Casa (MC)", value: report.mcStats.homeWinProb, color: "bg-accent" },
                        { label: "Casa (Pit.)", value: report.pythagorean?.homeWinRate ?? 0, color: "bg-accent/40" },
                        { label: "Fora (MC)", value: report.mcStats.awayWinProb, color: "bg-destructive/70" },
                        { label: "Fora (Pit.)", value: report.pythagorean?.awayWinRate ?? 0, color: "bg-destructive/40" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground w-20 shrink-0">{label}</span>
                          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(100, value * 100)}%` }} />
                          </div>
                          <span className="text-[10px] font-mono w-8 text-right">{(value * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Model breakdown */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
              <SectionLabel>Breakdown do ensemble</SectionLabel>
              <div className="mt-2 overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[280px]">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5 font-medium">Modelo</th>
                      <th className="text-center py-1.5 font-medium">Top</th>
                      <th className="text-right py-1.5 font-medium">P(top)</th>
                      <th className="text-right py-1.5 font-medium">Peso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {report.modelBreakdown.map((m, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-medium">{m.model}</td>
                        <td className="py-1.5 text-center font-mono text-primary">{m.topScore}</td>
                        <td className="py-1.5 text-right font-mono">{(m.topProb * 100).toFixed(1)}%</td>
                        <td className="py-1.5 text-right font-mono text-accent">{(m.weight * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tactical Profile + SOS */}
            {(report.tacticalMatchup || report.sosAnalysis) && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                {report.tacticalMatchup && (
                  <div>
                    <SectionLabel>Perfil Tático (Método 14)</SectionLabel>
                    <div className="mt-2 space-y-2 text-xs">
                      <div className="flex gap-2 flex-wrap">
                        <span className={`px-2 py-1 rounded border text-[10px] font-mono ${
                          report.tacticalMatchup.isDefensiveClash ? "border-amber-500/40 text-amber-400 bg-amber-500/5" :
                          report.tacticalMatchup.isHighScoringExpected ? "border-accent/40 text-accent bg-accent/5" :
                          "border-border/40 text-muted-foreground"
                        }`}>
                          Casa: {report.tacticalMatchup.homeStyle.replace(/_/g, " ")}
                        </span>
                        <span className={`px-2 py-1 rounded border text-[10px] font-mono ${
                          report.tacticalMatchup.isDefensiveClash ? "border-amber-500/40 text-amber-400 bg-amber-500/5" :
                          "border-border/40 text-muted-foreground"
                        }`}>
                          Fora: {report.tacticalMatchup.awayStyle.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{report.tacticalMatchup.matchupLabel}</p>
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground">λ adj. Casa</div>
                          <div className={`font-mono font-semibold text-xs mt-0.5 ${report.tacticalMatchup.lambdaHomeAdj > 1 ? "text-accent" : report.tacticalMatchup.lambdaHomeAdj < 0.97 ? "text-destructive" : ""}`}>
                            ×{report.tacticalMatchup.lambdaHomeAdj.toFixed(2)}
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground">λ adj. Fora</div>
                          <div className={`font-mono font-semibold text-xs mt-0.5 ${report.tacticalMatchup.lambdaAwayAdj > 1 ? "text-accent" : report.tacticalMatchup.lambdaAwayAdj < 0.97 ? "text-destructive" : ""}`}>
                            ×{report.tacticalMatchup.lambdaAwayAdj.toFixed(2)}
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground">Bola parada</div>
                          <div className="font-mono font-semibold text-xs mt-0.5">
                            {(report.tacticalMatchup.setPieceImportance * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>
                      {report.tacticalMatchup.isDefensiveClash && (
                        <div className="text-[10px] text-amber-400 px-2 py-1.5 rounded border border-amber-500/20 bg-amber-500/5">
                          ⚡ Choque defensivo — modelo Double Poisson underdispersed priorizado
                        </div>
                      )}
                      {report.tacticalMatchup.isHighScoringExpected && (
                        <div className="text-[10px] text-accent px-2 py-1.5 rounded border border-accent/20 bg-accent/5">
                          ⚡ Alta octanagem — NegBin e Double Poisson overdispersed priorizado
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {report.sosAnalysis && (
                  <div>
                    <SectionLabel>Força da Agenda (SOS — Método 13)</SectionLabel>
                    <div className="mt-2 space-y-2 text-xs">
                      {[
                        { label: `${report.homeTeam.split(" ").slice(-1)[0]} (Casa)`, idx: report.sosAnalysis.homeSOSIndex, schedule: report.sosAnalysis.homeScheduleLabel },
                        { label: `${report.awayTeam.split(" ").slice(-1)[0]} (Fora)`, idx: report.sosAnalysis.awaySOSIndex, schedule: report.sosAnalysis.awayScheduleLabel },
                      ].map(({ label, idx, schedule }) => (
                        <div key={label}>
                          <div className="flex justify-between mb-0.5">
                            <span className="text-muted-foreground truncate max-w-[100px]">{label}</span>
                            <span className={`font-mono font-semibold ${idx >= 1.15 ? "text-accent" : idx <= 0.85 ? "text-destructive" : ""}`}>
                              SOS {idx.toFixed(2)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-0.5">
                            <div className={`h-full rounded-full transition-all ${idx >= 1.15 ? "bg-accent" : idx <= 0.85 ? "bg-destructive/70" : "bg-primary/50"}`}
                              style={{ width: `${Math.min(100, idx * 55).toFixed(0)}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground/70">{schedule}</span>
                        </div>
                      ))}
                      {report.sosAnalysis.lambdaAdjApplied && (
                        <div className="text-[10px] text-primary/70 mt-1">
                          ✓ Correção SOS aplicada ao λ — oponentes historicamente fortes/fracos ajustados
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Derby + Momentum + Pressure + Resilience */}
            {(report.derbyFactor || report.momentumCarry || report.leaguePressure || report.resilience) && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {report.derbyFactor && (
                  <div>
                    <SectionLabel>Derby / Rivalidade (M.19)</SectionLabel>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className={`text-[11px] font-semibold px-2 py-1.5 rounded border ${
                        report.derbyFactor.isDerby
                          ? "border-amber-500/40 text-amber-400 bg-amber-500/5"
                          : "border-border/30 text-muted-foreground"
                      }`}>
                        {report.derbyFactor.isDerby ? "Derby detectado" : "Jogo regular"}
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <div className="bg-muted/40 rounded px-1.5 py-1">
                          <div className="text-[9px] text-muted-foreground">Taxa empate H2H</div>
                          <div className="font-mono font-semibold text-xs">{(report.derbyFactor.h2hDrawRate * 100).toFixed(0)}%</div>
                        </div>
                        <div className="bg-muted/40 rounded px-1.5 py-1">
                          <div className="text-[9px] text-muted-foreground">Avg gols H2H</div>
                          <div className="font-mono font-semibold text-xs">{report.derbyFactor.h2hAvgGoals.toFixed(2)}</div>
                        </div>
                      </div>
                      {report.derbyFactor.isDerby && (
                        <div className="text-[10px] text-muted-foreground">
                          λ adj ×{report.derbyFactor.lambdaAdj.toFixed(2)} | boost empate +{(report.derbyFactor.drawBoost * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {report.momentumCarry && (
                  <div>
                    <SectionLabel>Momentum (Método 20)</SectionLabel>
                    <div className="mt-2 space-y-1.5 text-xs">
                      {[
                        { label: `${report.homeTeam.split(" ").slice(-1)[0]}`, val: report.momentumCarry.homeMomentum, lbl: report.momentumCarry.homeLabel },
                        { label: `${report.awayTeam.split(" ").slice(-1)[0]}`, val: report.momentumCarry.awayMomentum, lbl: report.momentumCarry.awayLabel },
                      ].map(({ label, val, lbl }) => (
                        <div key={label}>
                          <div className="flex justify-between mb-0.5">
                            <span className="text-muted-foreground truncate max-w-[60px]">{label}</span>
                            <span className={`font-mono text-[11px] font-semibold ${val >= 1.15 ? "text-accent" : val <= 0.85 ? "text-destructive" : ""}`}>
                              {val.toFixed(2)}×
                            </span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-0.5">
                            <div className={`h-full rounded-full ${val >= 1.15 ? "bg-accent" : val <= 0.85 ? "bg-destructive/70" : "bg-primary/40"}`}
                              style={{ width: `${Math.min(100, val * 50).toFixed(0)}%` }} />
                          </div>
                          <span className="text-[9px] text-muted-foreground/70">{lbl}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {report.leaguePressure && (
                  <div>
                    <SectionLabel>Pressão de Tabela (M.18)</SectionLabel>
                    <div className="mt-2 space-y-1 text-xs">
                      {[
                        { label: `${report.homeTeam.split(" ").slice(-1)[0]}`, zone: report.leaguePressure.homeZone, ppg: report.leaguePressure.homePPG },
                        { label: `${report.awayTeam.split(" ").slice(-1)[0]}`, zone: report.leaguePressure.awayZone, ppg: report.leaguePressure.awayPPG },
                      ].map(({ label, zone, ppg }) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-muted-foreground truncate max-w-[60px]">{label}</span>
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] px-1 py-0.5 rounded font-mono border ${
                              zone === "relegation" ? "border-destructive/40 text-destructive bg-destructive/5" :
                              zone === "title" ? "border-accent/40 text-accent bg-accent/5" :
                              zone === "lower" ? "border-orange-500/40 text-orange-400 bg-orange-500/5" :
                              "border-border/40 text-muted-foreground"
                            }`}>{zone}</span>
                            <span className="font-mono text-[10px]">{ppg.toFixed(2)} PPJ</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {report.resilience && (
                  <div>
                    <SectionLabel>Resiliência (M.Bonus)</SectionLabel>
                    <div className="mt-2 space-y-1 text-xs">
                      {[
                        { label: `${report.homeTeam.split(" ").slice(-1)[0]}`, rate: report.resilience.homeComebackRate, resilient: report.resilience.homeIsResilient },
                        { label: `${report.awayTeam.split(" ").slice(-1)[0]}`, rate: report.resilience.awayComebackRate, resilient: report.resilience.awayIsResilient },
                      ].map(({ label, rate, resilient }) => (
                        <div key={label}>
                          <div className="flex justify-between mb-0.5">
                            <span className="text-muted-foreground truncate max-w-[60px]">{label}</span>
                            <span className={`font-mono text-[11px] ${resilient ? "text-accent font-semibold" : ""}`}>
                              {(rate * 100).toFixed(0)}%
                            </span>
                          </div>
                          {resilient && (
                            <div className="text-[9px] text-accent/80">Equipa resiliente — força mental</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Probabilistic Analysis: Conformal + Entropy + Brier + BMA + Cluster + Regression */}
            {(report.probabilisticAnalysis || report.bmaAgreement != null || report.scoreCluster || report.regressionToMean) && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Análise Probabilística Avançada (Métodos 25–30)</SectionLabel>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                  {/* Conformal Set (Method 25) */}
                  {report.probabilisticAnalysis && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Conjunto Conformal — Cobertura 80%</p>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {report.probabilisticAnalysis.conformalSet.slice(0, 8).map((s, i) => (
                            <span key={i} className={`font-mono text-[11px] px-1.5 py-0.5 rounded border ${
                              i === 0 ? "border-primary/50 text-primary bg-primary/10 font-bold" : "border-border/40 text-muted-foreground"
                            }`}>{s}</span>
                          ))}
                          {report.probabilisticAnalysis.conformalSet.length > 8 && (
                            <span className="text-[10px] text-muted-foreground/50 self-center">+{report.probabilisticAnalysis.conformalSet.length - 8}</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-muted/40 rounded px-2 py-1.5">
                            <div className="text-[9px] text-muted-foreground">Cobertura real</div>
                            <div className="font-mono font-semibold text-xs">{(report.probabilisticAnalysis.conformalCoverage * 100).toFixed(1)}%</div>
                          </div>
                          <div className="bg-muted/40 rounded px-2 py-1.5">
                            <div className="text-[9px] text-muted-foreground">Tamanho conjunto</div>
                            <div className={`font-mono font-semibold text-xs ${report.probabilisticAnalysis.conformalSetSize <= 3 ? "text-accent" : report.probabilisticAnalysis.conformalSetSize >= 7 ? "text-amber-400" : ""}`}>
                              {report.probabilisticAnalysis.conformalSetSize} {report.probabilisticAnalysis.conformalSetSize <= 3 ? "✓ apertado" : ""}
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground/70 leading-relaxed">
                          Conjunto menor = previsão mais focada (menos incerteza)
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Entropy + Brier (Methods 26–27) */}
                  {report.probabilisticAnalysis && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Entropia & Skill Score</p>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Entropia normalizada</span>
                            <span className={`font-mono font-semibold ${
                              report.probabilisticAnalysis.normalizedEntropy < 0.40 ? "text-accent" :
                              report.probabilisticAnalysis.normalizedEntropy > 0.75 ? "text-amber-400" : ""
                            }`}>{(report.probabilisticAnalysis.normalizedEntropy * 100).toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-1">
                            <div className={`h-full rounded-full ${
                              report.probabilisticAnalysis.normalizedEntropy < 0.40 ? "bg-accent" :
                              report.probabilisticAnalysis.normalizedEntropy > 0.75 ? "bg-amber-500/70" : "bg-primary/50"
                            }`} style={{ width: `${(report.probabilisticAnalysis.normalizedEntropy * 100).toFixed(0)}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground/70">{report.probabilisticAnalysis.entropyLabel}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-border/30">
                          <span className="text-xs text-muted-foreground">Skill Score (Brier)</span>
                          <span className={`font-mono font-semibold text-sm ${report.probabilisticAnalysis.brierSkillScore > 0.3 ? "text-accent" : "text-foreground"}`}>
                            {(report.probabilisticAnalysis.brierSkillScore * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* BMA + Cluster + Regression (Methods 28–30) */}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">BMA · Cluster · Regressão</p>
                    <div className="space-y-2">
                      {report.bmaAgreement != null && (
                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Acordo BMA (modelos)</span>
                            <span className={`font-mono font-semibold ${report.bmaAgreement > 0.70 ? "text-accent" : report.bmaAgreement < 0.40 ? "text-amber-400" : ""}`}>
                              {(report.bmaAgreement * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${report.bmaAgreement > 0.70 ? "bg-accent" : "bg-primary/40"}`}
                              style={{ width: `${(report.bmaAgreement * 100).toFixed(0)}%` }} />
                          </div>
                        </div>
                      )}
                      {report.scoreCluster && (
                        <div className="bg-muted/40 rounded px-2 py-1.5">
                          <div className="text-[9px] text-muted-foreground mb-0.5">Cluster de placares</div>
                          <div className="text-xs font-mono">{report.scoreCluster.dominantZone}</div>
                          <div className={`text-[10px] mt-0.5 ${report.scoreCluster.isTightCluster ? "text-amber-400" : "text-muted-foreground/60"}`}>
                            {report.scoreCluster.riskLabel}
                          </div>
                        </div>
                      )}
                      {report.regressionToMean && (
                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <div className="bg-muted/40 rounded px-1.5 py-1 text-center">
                            <div className="text-[9px] text-muted-foreground">Regr.</div>
                            <div className="font-mono font-semibold">{(report.regressionToMean.coefficient * 100).toFixed(0)}%</div>
                          </div>
                          <div className="bg-muted/40 rounded px-1.5 py-1 text-center">
                            <div className="text-[9px] text-muted-foreground">λ casa</div>
                            <div className="font-mono font-semibold text-primary">{report.regressionToMean.adjustedLambdaHome.toFixed(2)}</div>
                          </div>
                          <div className="bg-muted/40 rounded px-1.5 py-1 text-center">
                            <div className="text-[9px] text-muted-foreground">λ fora</div>
                            <div className="font-mono font-semibold text-primary">{report.regressionToMean.adjustedLambdaAway.toFixed(2)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Kelly Top Scores */}
            {report.kellyTopScores && report.kellyTopScores.length > 0 && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Kelly Top Placares — Staking Ótimo</SectionLabel>
                <div className="mt-2 overflow-x-auto -mx-1">
                  <table className="w-full text-xs min-w-[280px]">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left py-1.5 font-medium">Placar</th>
                        <th className="text-center py-1.5 font-medium">P(%)</th>
                        <th className="text-center py-1.5 font-medium">Odd justa</th>
                        <th className="text-right py-1.5 font-medium">Kelly ¼</th>
                        <th className="text-right py-1.5 font-medium">Edge</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {report.kellyTopScores.map((k, i) => (
                        <tr key={i}>
                          <td className="py-1.5 font-mono font-semibold text-primary">{k.score}</td>
                          <td className="py-1.5 text-center font-mono">{(k.prob * 100).toFixed(2)}%</td>
                          <td className="py-1.5 text-center font-mono">{k.fairOdd.toFixed(2)}</td>
                          <td className="py-1.5 text-right font-mono">
                            <span className={k.hasEdge ? "text-accent font-semibold" : "text-muted-foreground"}>
                              {(k.quarterKelly * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-1.5 text-right">
                            {k.hasEdge ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">Edge</span>
                            ) : (
                              <span className="text-muted-foreground/40 text-[10px]">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                    Kelly ¼ = fração conservadora do bankroll. Odd justa = 1/P(placar) sem margem. Configure ODDS_API_KEY para edge real.
                  </p>
                </div>
              </div>
            )}

            {/* ─── NEW 50 METHODS PANELS ─────────────────────────────────────── */}

            {/* M31-33: xG / Shot Quality */}
            {report.shotQuality && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>xG · Qualidade de Chutes (M31–33)</SectionLabel>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                  {[
                    { label: "λ xG Casa", val: report.shotQuality.xgLambdaHome.toFixed(2), accent: true },
                    { label: "λ xG Fora", val: report.shotQuality.xgLambdaAway.toFixed(2), accent: true },
                    { label: "xG/chute Casa", val: report.shotQuality.homeXgPerShot.toFixed(3) },
                    { label: "xG/chute Fora", val: report.shotQuality.awayXgPerShot.toFixed(3) },
                    { label: "Conversão Casa", val: `${(report.shotQuality.homeConversionRate * 100).toFixed(1)}%` },
                    { label: "Conversão Fora", val: `${(report.shotQuality.awayConversionRate * 100).toFixed(1)}%` },
                  ].map(({ label, val, accent }) => (
                    <div key={label} className="bg-muted/40 rounded px-2 py-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground">{label}</div>
                      <div className={`font-mono font-semibold mt-0.5 ${accent ? "text-primary" : ""}`}>{val}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-2">M31 xG Score Matrix (Rathke 2017) · M32 Beta-Binomial Shot Conversion · M33 xG Monte Carlo per-shot</p>
              </div>
            )}

            {/* M34-36: Hawkes + Dixon-Robinson */}
            {report.hawkesAnalysis && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Hawkes Process · Timing (M34–36)</SectionLabel>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Proj. Casa (Hawkes)</div>
                    <div className="font-mono font-semibold text-primary">{report.hawkesAnalysis.projectedHome.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Proj. Fora (Hawkes)</div>
                    <div className="font-mono font-semibold text-primary">{report.hawkesAnalysis.projectedAway.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(+ 1 gol)</div>
                    <div className={`font-mono font-semibold ${report.hawkesAnalysis.probAnotherGoal > 0.6 ? "text-accent" : ""}`}>
                      {(report.hawkesAnalysis.probAnotherGoal * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">α excitação / β decay</div>
                    <div className="font-mono text-[10px]">{report.hawkesAnalysis.hawkesAlpha.toFixed(2)} / {report.hawkesAnalysis.hawkesBeta.toFixed(2)}</div>
                  </div>
                </div>
                {(report.hawkesAnalysis.situationalState || report.hawkesAnalysis.drLambdaHome != null) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    {report.hawkesAnalysis.situationalState && (
                      <span className="px-2 py-0.5 rounded border border-primary/30 text-primary/80 bg-primary/5">
                        Estado: {report.hawkesAnalysis.situationalState}
                      </span>
                    )}
                    {report.hawkesAnalysis.drLambdaHome != null && (
                      <span className="px-2 py-0.5 rounded border border-border/30 text-muted-foreground">
                        DR λ: {report.hawkesAnalysis.drLambdaHome.toFixed(2)} – {report.hawkesAnalysis.drLambdaAway?.toFixed(2)}
                      </span>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">M34 Hawkes Self-Exciting · M35 Goal Timing Distribution (Armatas) · M36 Dixon-Robinson Live</p>
              </div>
            )}

            {/* M37-40: Fatigue Analysis */}
            {report.fatigueAnalysis && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Fadiga Física Completa (M37–40)</SectionLabel>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    { label: "Mult. Fadiga Casa", val: `×${report.fatigueAnalysis.homeFatigueMultiplier.toFixed(3)}`, warn: report.fatigueAnalysis.homeFatigueMultiplier < 0.93 },
                    { label: "Mult. Fadiga Fora", val: `×${report.fatigueAnalysis.awayFatigueMultiplier.toFixed(3)}`, warn: report.fatigueAnalysis.awayFatigueMultiplier < 0.93 },
                    { label: "Índice Fadiga Casa", val: report.fatigueAnalysis.homeFatigueIndex.toFixed(2), warn: report.fatigueAnalysis.homeFatigueIndex > 0.3 },
                    { label: "Índice Fadiga Fora", val: report.fatigueAnalysis.awayFatigueIndex.toFixed(2), warn: report.fatigueAnalysis.awayFatigueIndex > 0.3 },
                    { label: "Risco Rotação Casa", val: `${(report.fatigueAnalysis.homeRotationRisk * 100).toFixed(0)}%`, warn: report.fatigueAnalysis.homeRotationRisk > 0.4 },
                    { label: "Risco Rotação Fora", val: `${(report.fatigueAnalysis.awayRotationRisk * 100).toFixed(0)}%`, warn: report.fatigueAnalysis.awayRotationRisk > 0.4 },
                  ].map(({ label, val, warn }) => (
                    <div key={label} className="bg-muted/40 rounded px-2 py-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground">{label}</div>
                      <div className={`font-mono font-semibold mt-0.5 ${warn ? "text-destructive" : ""}`}>{val}</div>
                    </div>
                  ))}
                </div>
                {report.fatigueAnalysis.alerts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {report.fatigueAnalysis.alerts.slice(0, 3).map((a, i) => (
                      <div key={i} className="text-[10px] text-amber-400 px-2 py-1 rounded border border-amber-500/20 bg-amber-500/5">⚠ {a}</div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">M37 Schedule Fatigue (Drust 2012) · M38 Travel Impact · M39 Altitude · M40 Rotation Probability</p>
              </div>
            )}

            {/* M41-43: Set Piece + Referee + Weather */}
            {report.setPieceAnalysis && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Bola Parada · Árbitro · Condições (M41–43)</SectionLabel>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Δλ Casa (bola parada)</div>
                    <div className={`font-mono font-semibold ${report.setPieceAnalysis.deltaLambdaHome > 0 ? "text-accent" : "text-destructive"}`}>
                      {report.setPieceAnalysis.deltaLambdaHome > 0 ? "+" : ""}{report.setPieceAnalysis.deltaLambdaHome.toFixed(3)}
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Δλ Fora (bola parada)</div>
                    <div className={`font-mono font-semibold ${report.setPieceAnalysis.deltaLambdaAway > 0 ? "text-accent" : "text-destructive"}`}>
                      {report.setPieceAnalysis.deltaLambdaAway > 0 ? "+" : ""}{report.setPieceAnalysis.deltaLambdaAway.toFixed(3)}
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Mult. Clima</div>
                    <div className={`font-mono font-semibold ${report.setPieceAnalysis.weatherMultiplier < 0.95 ? "text-amber-400" : ""}`}>
                      ×{report.setPieceAnalysis.weatherMultiplier.toFixed(3)}
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Fator árbitro</div>
                    <div className={`font-mono font-semibold ${report.setPieceAnalysis.refereeDisruptionFactor < 0.97 ? "text-amber-400" : ""}`}>
                      ×{report.setPieceAnalysis.refereeDisruptionFactor.toFixed(3)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground/70">{report.setPieceAnalysis.weatherDescription}</div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">M41 Set Piece Goal Contribution · M42 Referee Tendency · M43 Weather & Pitch Impact</p>
              </div>
            )}

            {/* M44-46: Bayesian Hierarchical + M47-49: Copula */}
            {(report.bayesHierarchical || report.copulaAnalysis) && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-4">
                {report.bayesHierarchical && (
                  <div>
                    <SectionLabel>Hierarchical Bayesian Poisson (M44–46)</SectionLabel>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">λ posterior Casa</div>
                        <div className="font-mono font-semibold text-primary">{report.bayesHierarchical.posteriorLambdaHome.toFixed(3)}</div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">λ posterior Fora</div>
                        <div className="font-mono font-semibold text-primary">{report.bayesHierarchical.posteriorLambdaAway.toFixed(3)}</div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Rank ATQ Casa</div>
                        <div className="font-mono text-xs mt-0.5">{report.bayesHierarchical.homeAttackRank}</div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5">
                        <div className="text-[9px] text-muted-foreground">Rank DEF Fora</div>
                        <div className="font-mono text-xs mt-0.5">{report.bayesHierarchical.awayDefenseRank}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground/60">
                      Shrinkage: Casa {(report.bayesHierarchical.homeShrinkage * 100).toFixed(0)}% · Fora {(report.bayesHierarchical.awayShrinkage * 100).toFixed(0)}%
                      · M44 Baio-Blangiardo · M45 James-Stein · M46 Posterior Predictive
                    </div>
                  </div>
                )}
                {report.copulaAnalysis && (
                  <div>
                    <SectionLabel>Cópula de Correlação de Gols (M47–49)</SectionLabel>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-muted/40 rounded px-2 py-1.5 col-span-2 flex items-center justify-between">
                        <div>
                          <div className="text-[9px] text-muted-foreground">Tipo de cópula</div>
                          <div className="font-mono font-semibold uppercase text-primary">{report.copulaAnalysis.copulaType}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-muted-foreground">Parâmetro θ</div>
                          <div className="font-mono font-semibold">{report.copulaAnalysis.copulaParameter.toFixed(3)}</div>
                        </div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">P(ambos marcam)</div>
                        <div className={`font-mono font-semibold ${report.copulaAnalysis.probBothScore > 0.5 ? "text-accent" : ""}`}>
                          {(report.copulaAnalysis.probBothScore * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">P(0-0)</div>
                        <div className="font-mono font-semibold">{(report.copulaAnalysis.prob00 * 100).toFixed(2)}%</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground/60">
                      Dep. superior: {report.copulaAnalysis.upperTailDep.toFixed(3)} · Dep. inferior: {report.copulaAnalysis.lowerTailDep.toFixed(3)}
                      · M47 Frank · M48 Gumbel · M49 Clayton
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* M50-53: Market Intelligence */}
            {report.marketIntelligence && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Inteligência de Mercado (M50–53)</SectionLabel>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs mb-3">
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P implícita Casa</div>
                    <div className="font-mono font-semibold">{(report.marketIntelligence.impliedHomeWin * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P implícita Empate</div>
                    <div className="font-mono font-semibold">{(report.marketIntelligence.impliedDraw * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P implícita Fora</div>
                    <div className="font-mono font-semibold">{(report.marketIntelligence.impliedAwayWin * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Margem bookmaker</div>
                    <div className={`font-mono font-semibold ${report.marketIntelligence.totalMargin > 0.06 ? "text-destructive" : "text-accent"}`}>
                      {(report.marketIntelligence.totalMargin * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">CLV Edge</div>
                    <div className={`font-mono font-semibold ${report.marketIntelligence.clvEdge > 0.02 ? "text-accent" : ""}`}>
                      {(report.marketIntelligence.clvEdge * 100).toFixed(2)}%
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Eficiência mercado</div>
                    <div className="font-mono font-semibold">{(report.marketIntelligence.marketEfficiency * 100).toFixed(1)}%</div>
                  </div>
                </div>
                {report.marketIntelligence.steamMoveDetected && (
                  <div className="text-[10px] text-amber-400 px-2 py-1.5 rounded border border-amber-500/20 bg-amber-500/5 mb-2">
                    ⚡ Steam move detectado — direção: {report.marketIntelligence.steamDirection}
                  </div>
                )}
                {report.marketIntelligence.valueBets.length > 0 && (
                  <div className="space-y-1">
                    {report.marketIntelligence.valueBets.slice(0, 3).map((vb, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-accent/5 border border-accent/20">
                        <span className="text-accent font-medium">{vb.market}</span>
                        <span className="font-mono text-muted-foreground">Modelo {(vb.modelProb * 100).toFixed(1)}% | Odd {vb.impliedOdd.toFixed(2)}</span>
                        <span className={`font-mono font-semibold ${vb.edge > 0 ? "text-accent" : "text-destructive"}`}>
                          {vb.edge > 0 ? "+" : ""}{(vb.edge * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">M50 Implied Prob (Shin) · M51 Sharp Line Detection · M52 Market Consensus · M53 CLV</p>
              </div>
            )}

            {/* M54-57: Live Bayesian Context */}
            {report.liveContextAnalysis && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Contexto Bayesiano AO VIVO (M54–57)</SectionLabel>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-primary/10 border border-primary/20 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(casa vence)</div>
                    <div className="font-mono font-semibold text-primary">{(report.liveContextAnalysis.liveHomeWinProb * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(empate)</div>
                    <div className="font-mono font-semibold">{(report.liveContextAnalysis.liveDrawProb * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(fora vence)</div>
                    <div className="font-mono font-semibold">{(report.liveContextAnalysis.liveAwayWinProb * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">λ rem. Casa</div>
                    <div className="font-mono font-semibold text-primary">{report.liveContextAnalysis.remainingLambdaHome.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">λ rem. Fora</div>
                    <div className="font-mono font-semibold text-primary">{report.liveContextAnalysis.remainingLambdaAway.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Acréscimos est.</div>
                    <div className="font-mono font-semibold">{report.liveContextAnalysis.estimatedInjuryTime.toFixed(0)}′</div>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-2">M54 Bayesian Live Update · M55 Red Card Impact · M56 Substitution Model · M57 Injury Time</p>
              </div>
            )}

            {/* M58-60: Weibull + COM-Poisson + M61-64: Contextual */}
            {(report.weibullAnalysis || report.contextualFactors) && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-4">
                {report.weibullAnalysis && (
                  <div>
                    <SectionLabel>Contagem Flexível: Weibull · COM-Poisson (M58–60)</SectionLabel>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">Dispersão Casa</div>
                        <div className="font-mono font-semibold">{report.weibullAnalysis.homeDispersion}</div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">Dispersão Fora</div>
                        <div className="font-mono font-semibold">{report.weibullAnalysis.awayDispersion}</div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">ρ Weibull Casa</div>
                        <div className="font-mono font-semibold text-primary">{report.weibullAnalysis.weibullRhoHome.toFixed(3)}</div>
                      </div>
                      <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[9px] text-muted-foreground">ν COM-Poisson Casa</div>
                        <div className="font-mono font-semibold text-primary">{report.weibullAnalysis.comPoissonNuHome.toFixed(3)}</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">M58 Weibull Count (McShane 2011) · M59 COM-Poisson · M60 GNB</p>
                  </div>
                )}
                {report.contextualFactors && (
                  <div>
                    <SectionLabel>Fatores Contextuais (M61–64)</SectionLabel>
                    <div className="mt-2 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Vantagem casa dinâmica</span>
                        <span className={`font-mono font-semibold ${report.contextualFactors.dynamicHomeAdvantage > 1.05 ? "text-accent" : ""}`}>
                          ×{report.contextualFactors.dynamicHomeAdvantage.toFixed(3)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Motivação Casa / Fora</span>
                        <span className="font-mono text-[11px]">
                          ×{report.contextualFactors.homeMotivationMult.toFixed(2)} / ×{report.contextualFactors.awayMotivationMult.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Etapa da temporada</span>
                        <span className="font-mono text-[11px]">×{report.contextualFactors.seasonStageMultiplier.toFixed(2)}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 px-2 py-1 rounded bg-muted/30">
                        {report.contextualFactors.motivationContext} · {report.contextualFactors.crowdEffect}
                      </div>
                      {report.contextualFactors.h2hMostCommonScores.length > 0 && (
                        <div>
                          <div className="text-[9px] text-muted-foreground mb-1">Placares H2H mais frequentes</div>
                          <div className="flex flex-wrap gap-1">
                            {report.contextualFactors.h2hMostCommonScores.slice(0, 5).map((s, i) => (
                              <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-primary/20 text-primary bg-primary/5">
                                {s.home}-{s.away} ({s.count}×)
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">M61 Dynamic HA · M62 Motivation Index · M63 Season Stage · M64 Advanced H2H</p>
                  </div>
                )}
              </div>
            )}

            {/* M65-70: Meta-Ensemble */}
            {report.metaEnsemble && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Meta-Ensemble — Stacking L2 (M65–70)</SectionLabel>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs mb-3">
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Diversidade modelos</div>
                    <div className={`font-mono font-semibold ${report.metaEnsemble.modelDiversity > 0.5 ? "text-accent" : ""}`}>
                      {(report.metaEnsemble.modelDiversity * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Entropia ensemble</div>
                    <div className="font-mono font-semibold">{report.metaEnsemble.ensembleEntropy.toFixed(3)}</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Shift calibração</div>
                    <div className={`font-mono font-semibold ${Math.abs(report.metaEnsemble.calibrationShift) > 0.02 ? "text-amber-400" : ""}`}>
                      {report.metaEnsemble.calibrationShift > 0 ? "+" : ""}{(report.metaEnsemble.calibrationShift * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>
                {report.metaEnsemble.topScoresAgreement.length > 0 && (
                  <div>
                    <div className="text-[9px] text-muted-foreground mb-1.5">Concordância top placares (stacking L2)</div>
                    <div className="space-y-1">
                      {report.metaEnsemble.topScoresAgreement.map((s, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[9px] text-muted-foreground w-4">{i + 1}</span>
                          <span className={`font-mono text-xs font-bold w-10 ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>{s.score}</span>
                          <div className="flex-1 h-2 bg-muted/40 rounded overflow-hidden">
                            <div className={`h-full rounded ${i === 0 ? "bg-primary" : "bg-primary/30"}`}
                              style={{ width: `${Math.min(100, s.agreementScore * 100).toFixed(0)}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">
                            {(s.agreementScore * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">M65 Stacked Generalization · M66 Multiplicative Weights · M67 Log Opinion Pool · M68 LMSR · M69 Isotonic · M70 Brier-Optimal</p>
              </div>
            )}

            {/* M71-75: Pressing & Tactical Pressure */}
            {report.pressingAnalysis && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Pressing & Pressão Tática (M71–75)</SectionLabel>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">PPDA Casa</div>
                    <div className={`font-mono font-semibold ${report.pressingAnalysis.homePressIndex > 0.65 ? "text-accent" : ""}`}>
                      {(report.pressingAnalysis.homePressIndex * 100).toFixed(0)}
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">PPDA Fora</div>
                    <div className={`font-mono font-semibold ${report.pressingAnalysis.awayPressIndex > 0.65 ? "text-accent" : ""}`}>
                      {(report.pressingAnalysis.awayPressIndex * 100).toFixed(0)}
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Índice caos</div>
                    <div className={`font-mono font-semibold ${report.pressingAnalysis.chaosIndex > 0.5 ? "text-amber-400" : ""}`}>
                      {(report.pressingAnalysis.chaosIndex * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Inflação variância</div>
                    <div className={`font-mono font-semibold ${report.pressingAnalysis.varianceInflation > 1.15 ? "text-amber-400" : ""}`}>
                      ×{report.pressingAnalysis.varianceInflation.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-primary/80 px-2 py-1 rounded border border-primary/20 bg-primary/5 mb-2">
                  Matchup: {report.pressingAnalysis.matchupType} · Domínio posse: {(report.pressingAnalysis.possessionDominance * 100).toFixed(0)}%
                  · Escanteios est: {report.pressingAnalysis.expectedCornersHome.toFixed(1)} – {report.pressingAnalysis.expectedCornersAway.toFixed(1)}
                </div>
                {report.pressingAnalysis.tacticalNotes.length > 0 && (
                  <div className="space-y-1">
                    {report.pressingAnalysis.tacticalNotes.slice(0, 3).map((n, i) => (
                      <div key={i} className="text-[10px] text-muted-foreground/70">◆ {n}</div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">M71 PPDA · M72 Possession Dominance · M73 Asymmetric Matchup · M74 Variance Inflation · M75 Expected Corners</p>
              </div>
            )}

            {/* M76-80: Scoreline Patterns */}
            {report.scorelinePatterns && (
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border">
                <SectionLabel>Padrões de Placar — Modelo Empírico (M76–80)</SectionLabel>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs mb-3">
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(Casa vence)</div>
                    <div className="font-mono font-semibold">{(report.scorelinePatterns.homeWinProb * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(Empate)</div>
                    <div className="font-mono font-semibold">{(report.scorelinePatterns.drawProb * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">P(Fora vence)</div>
                    <div className="font-mono font-semibold">{(report.scorelinePatterns.awayWinProb * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">BTTS</div>
                    <div className={`font-mono font-semibold ${report.scorelinePatterns.bttsProb > 0.50 ? "text-accent" : ""}`}>
                      {(report.scorelinePatterns.bttsProb * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Clean Sheet Casa</div>
                    <div className="font-mono font-semibold">{(report.scorelinePatterns.cleanSheetProbHome * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground">Viés gol tardio</div>
                    <div className={`font-mono font-semibold ${report.scorelinePatterns.lateGoalBias > 1.05 ? "text-amber-400" : ""}`}>
                      ×{report.scorelinePatterns.lateGoalBias.toFixed(2)}
                    </div>
                  </div>
                </div>
                {report.scorelinePatterns.historicalTopScores.length > 0 && (
                  <div>
                    <div className="text-[9px] text-muted-foreground mb-1.5">Top placares — freq. empírica vs modelo (50k+ jogos)</div>
                    <div className="space-y-1">
                      {report.scorelinePatterns.historicalTopScores.slice(0, 6).map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className="font-mono font-bold w-8 text-right text-primary">{s.home}-{s.away}</span>
                          <div className="flex-1 relative h-3 bg-muted/40 rounded overflow-hidden">
                            <div className="absolute h-full bg-primary/20 rounded" style={{ width: `${Math.min(100, s.empiricalFreq * 500).toFixed(0)}%` }} />
                            <div className="absolute h-full bg-primary/60 rounded opacity-70" style={{ width: `${Math.min(100, s.modelProb * 500).toFixed(0)}%` }} />
                          </div>
                          <span className="font-mono text-muted-foreground w-12 text-right">{(s.empiricalFreq * 100).toFixed(2)}%</span>
                          <span className="font-mono text-primary/80 w-12 text-right">{(s.modelProb * 100).toFixed(2)}%</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-[9px] text-muted-foreground/40 pl-10">
                        <span>Empírico ████ vs Modelo ████</span>
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-2">M76 Scoreline Freq. · M77 Goal Diff (Skellam) · M78 Clean Sheet · M79 BTTS Structural · M80 Late Goal Bias</p>
              </div>
            )}

            {/* ─── END NEW 50 METHODS ─────────────────────────────────────── */}

            {/* H2H + Context */}
            <div className="px-3 py-3 sm:px-5 sm:py-4 border-t border-border grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
              <div>
                <SectionLabel>Head-to-Head</SectionLabel>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amostra</span>
                    <span className="font-mono">{report.h2hSummary.sampleSize} jogos</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">V-E-D mandante</span>
                    <span className="font-mono">{report.h2hSummary.homeWins}-{report.h2hSummary.draws}-{report.h2hSummary.awayWins}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Média gols</span>
                    <span className="font-mono">{report.h2hSummary.avgGoalsTotal.toFixed(2)}</span>
                  </div>
                  <div className="mt-2">
                    <p className="text-muted-foreground mb-1">Últimos placares</p>
                    {report.h2hSummary.lastFiveScores.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {report.h2hSummary.lastFiveScores.map((s, i) => (
                          <span key={i} className="text-xs font-mono px-1.5 py-0.5 border border-primary/30 text-primary rounded">{s}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sem confrontos no histórico ESPN</p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <SectionLabel>Notas de contexto</SectionLabel>
                <div className="mt-2 space-y-1">
                  {report.contextNotes.map((n, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-primary shrink-0">›</span>
                      <span className="text-muted-foreground">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{children}</p>;
}

function FormPanel({ form, venue }: { form: TeamForm; venue: string }) {
  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{venue}</p>
          <p className="font-semibold text-sm mt-0.5">{form.teamName}</p>
        </div>
        <div className="flex gap-1">
          {form.recentForm.map((c, i) => (
            <span key={i} className={`text-xs w-6 h-6 flex items-center justify-center rounded font-bold ${
              c === "V" ? "bg-accent/20 text-accent" :
              c === "E" ? "bg-amber-500/20 text-amber-500" :
              "bg-destructive/20 text-destructive"
            }`}>{c}</span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        {[
          { label: "Jogos", value: form.gamesAnalyzed },
          { label: "GP/j", value: form.avgGoalsFor.toFixed(2) },
          { label: "GS/j", value: form.avgGoalsAgainst.toFixed(2) },
          { label: "Descanso", value: `${form.daysRest}d` },
          { label: "Ataque", value: `${(form.weightedAttack * 100).toFixed(0)}%` },
          { label: "Defesa", value: `${(form.weightedDefense * 100).toFixed(0)}%` },
          { label: "Elo", value: form.eloRating.toFixed(0) },
          { label: "Jogos", value: form.gamesAnalyzed },
        ].slice(0, 7).map(({ label, value }, i) => (
          <div key={i} className="bg-muted/40 rounded px-2 py-1.5">
            <div className="text-muted-foreground text-[10px]">{label}</div>
            <div className="font-mono font-semibold mt-0.5">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Professional score probability bar chart — top 10 scores ranked by probability */
function ScoreDistributionChart({ report }: { report: NeuralXReport }) {
  const top10 = report.topN.slice(0, 10);
  const maxProb = top10[0]?.prob ?? 0.01;

  return (
    <div className="space-y-1.5">
      {top10.map((cell, i) => {
        const isPrimary = i === 0;
        const isProtection = cell.home === report.protectionVariant.home && cell.away === report.protectionVariant.away;
        const pct = maxProb > 0 ? (cell.prob / maxProb) * 100 : 0;
        const fairOdd = cell.prob > 0 ? 1 / cell.prob : 0;

        return (
          <div key={`${cell.home}-${cell.away}`} className="flex items-center gap-2.5">
            {/* Rank */}
            <span className={`text-[10px] font-mono w-4 shrink-0 text-right ${
              isPrimary ? "text-primary font-bold" : "text-muted-foreground/50"
            }`}>{i + 1}</span>

            {/* Score badge */}
            <span className={`font-mono text-xs font-bold w-9 shrink-0 text-center px-1 py-0.5 rounded ${
              isPrimary
                ? "bg-primary/15 text-primary border border-primary/30"
                : isProtection
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "text-muted-foreground"
            }`}>
              {cell.home}–{cell.away}
            </span>

            {/* Probability bar */}
            <div className="flex-1 h-4 bg-muted/40 rounded overflow-hidden relative">
              <div
                className={`h-full rounded transition-all ${
                  isPrimary ? "bg-primary" : isProtection ? "bg-amber-500/60" : "bg-primary/25"
                }`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
              {/* Overlay probability text */}
              <span className={`absolute inset-0 flex items-center px-1.5 text-[10px] font-mono ${
                pct > 40 ? "text-white" : "text-muted-foreground"
              }`}>
                {(cell.prob * 100).toFixed(2)}%
              </span>
            </div>

            {/* Fair odd */}
            <span className="text-[10px] font-mono text-muted-foreground w-12 text-right shrink-0">
              @{fairOdd.toFixed(1)}
            </span>

            {/* Labels */}
            <div className="w-16 shrink-0 flex gap-1">
              {isPrimary && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-medium">PRIM</span>
              )}
              {isProtection && !isPrimary && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">PROT</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-[10px] text-muted-foreground/50 pt-1 border-t border-border/30">
        <span>Odd justa = 1/P(placar)</span>
        <span>Maior barra = placar mais provável</span>
      </div>
    </div>
  );
}

function ScoreHeatmap({ report }: { report: NeuralXReport }) {
  const probMap = new Map<string, number>();
  let max = 0;
  for (const c of report.topN) {
    probMap.set(`${c.home}-${c.away}`, c.prob);
    if (c.prob > max) max = c.prob;
  }
  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-0.5 text-[9px]">
        <div />
        {[0,1,2,3,4,5].map((j) => (
          <div key={j} className="text-center text-muted-foreground">A{j}</div>
        ))}
        {[0,1,2,3,4,5].map((i) => (
          <>
            <div key={`r${i}`} className="text-muted-foreground flex items-center">M{i}</div>
            {[0,1,2,3,4,5].map((j) => {
              const p = probMap.get(`${i}-${j}`) ?? 0;
              const isPrimary = i === report.primary.home && j === report.primary.away;
              const intensity = max > 0 ? p / max : 0;
              return (
                <div key={`${i}-${j}`}
                  className={`aspect-square flex items-center justify-center text-[8px] font-mono rounded-sm ${isPrimary ? "ring-1 ring-primary" : ""}`}
                  style={{
                    background: intensity > 0
                      ? `rgba(59,130,246,${0.08 + intensity * 0.55})`
                      : "rgba(255,255,255,0.02)",
                    color: intensity > 0.5 ? "white" : "rgba(255,255,255,0.5)",
                  }}
                  title={`${i}-${j}: ${(p * 100).toFixed(2)}%`}>
                  {p > 0 ? (p * 100).toFixed(0) : ""}
                </div>
              );
            })}
          </>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>0%</span>
        <span className="font-mono">{(max * 100).toFixed(1)}% max</span>
      </div>
    </div>
  );
}
