import { useState } from "react";
import {
  useLiveRecalibrate,
  useGetLiveGames,
  getGetLiveGamesQueryKey,
} from "@workspace/api-client-react";
import type { LiveRecalibrateOut, LiveGameOut } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";

const LIVE_PICK_STYLES: Record<string, { border: string; bg: string; badge: string; score: string }> = {
  OURO:   { border: "border-amber-400/50",   bg: "bg-amber-400/8",   badge: "bg-amber-400/20 text-amber-300 border-amber-400/40",   score: "text-amber-300" },
  PRATA:  { border: "border-zinc-400/40",    bg: "bg-zinc-400/5",    badge: "bg-zinc-400/20 text-zinc-300 border-zinc-400/40",      score: "text-zinc-200" },
  BRONZE: { border: "border-orange-600/40",  bg: "bg-orange-600/5",  badge: "bg-orange-600/20 text-orange-300 border-orange-600/40", score: "text-orange-300" },
};

type BettingMarkets = NonNullable<LiveRecalibrateOut["bettingMarkets"]>;

function BookmakerPanel({ bm }: { bm: BettingMarkets }) {
  return (
    <div className="pt-1 border-t border-border/30">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
          Odds Bookie — {bm.bookmaker}
        </p>
        {bm.edgeHighlights && bm.edgeHighlights.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-medium">
            {bm.edgeHighlights.length} edge{bm.edgeHighlights.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {bm.edgeHighlights && bm.edgeHighlights.length > 0 && (
        <div className="mb-2.5 p-2 bg-accent/5 border border-accent/20 rounded-lg">
          <p className="text-[9px] text-accent uppercase tracking-wide font-medium mb-1.5">Vantagem Modelo vs Mercado</p>
          <div className="space-y-1">
            {bm.edgeHighlights.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">{e.market} <span className="font-mono text-foreground">{e.value}</span></span>
                <span className={`font-mono font-semibold ${(e.edgePct ?? 0) >= 15 ? "text-accent" : "text-primary"}`}>
                  +{(e.edgePct ?? 0).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {bm.oneX2 && (
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">1X2</p>
            <div className="space-y-0.5 text-[10px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Casa</span><span className="font-mono font-semibold">{bm.oneX2.homeOdd?.toFixed(2)}</span></div>
              {(bm.oneX2.drawOdd ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Emp.</span><span className="font-mono font-semibold">{bm.oneX2.drawOdd?.toFixed(2)}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Fora</span><span className="font-mono font-semibold">{bm.oneX2.awayOdd?.toFixed(2)}</span></div>
            </div>
          </div>
        )}
        {bm.overUnder && bm.overUnder.length > 0 && (
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Over/Under</p>
            <div className="space-y-0.5 text-[10px]">
              {bm.overUnder.slice(0, 3).map((ou, i) => (
                <div key={i} className="flex justify-between gap-1">
                  <span className="text-muted-foreground font-mono">{ou.line}</span>
                  <span className="font-mono text-primary">{ou.overOdd?.toFixed(2)}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-mono">{ou.underOdd?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bm.btts && (
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">BTTS</p>
            <div className="space-y-0.5 text-[10px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Sim</span><span className="font-mono font-semibold text-amber-500">{bm.btts.yesOdd?.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Não</span><span className="font-mono font-semibold">{bm.btts.noOdd?.toFixed(2)}</span></div>
            </div>
          </div>
        )}
        {bm.exactScore && bm.exactScore.length > 0 && (
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Placar Exato</p>
            <div className="space-y-0.5 text-[10px]">
              {bm.exactScore.slice(0, 5).map((es, i) => (
                <div key={i} className="flex justify-between gap-1">
                  <span className="font-mono text-muted-foreground">{es.score}</span>
                  <span className="font-mono">{es.odd?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bm.htFt && bm.htFt.length > 0 && (
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">HT/FT</p>
            <div className="space-y-0.5 text-[10px]">
              {bm.htFt.slice(0, 5).map((h, i) => (
                <div key={i} className="flex justify-between gap-1">
                  <span className="text-muted-foreground font-mono text-[9px] truncate">{h.ht}/{h.ft}</span>
                  <span className="font-mono shrink-0">{h.odd?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bm.handicap && bm.handicap.length > 0 && (
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Handicap</p>
            <div className="space-y-0.5 text-[10px]">
              {bm.handicap.slice(0, 4).map((hc, i) => (
                <div key={i} className="flex justify-between gap-1">
                  <span className="font-mono text-muted-foreground">{(hc.spread ?? 0) > 0 ? `+${hc.spread}` : hc.spread}</span>
                  <span className="font-mono text-primary">{hc.homeOdd?.toFixed(2)}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-mono">{hc.awayOdd?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveRecalibratePanel({ result, onClose }: { result: LiveRecalibrateOut; onClose: () => void }) {
  const isLive = result.isLive ?? result.liveMinute > 0;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22 }}
      className={`border-t overflow-hidden ${isLive ? "border-red-500/30 bg-red-500/3" : "border-primary/20 bg-primary/2"}`}
    >
      <div className="px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isLive ? "bg-red-400 animate-pulse" : "bg-primary"}`} />
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${isLive ? "text-red-400" : "text-primary"}`}>
              {isLive
                ? `Recalibração ao Vivo — ${result.liveMinute}'  ${result.liveHomeScore}–${result.liveAwayScore}`
                : `Análise Pré-Jogo — ${result.homeTeam} × ${result.awayTeam}`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 border border-border/40 rounded"
          >
            fechar
          </button>
        </div>

        {/* Analysis context */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">{result.analysisContext}</p>

        {/* 3 picks */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {result.top3.map((pick, i) => {
            const st = LIVE_PICK_STYLES[pick.label] ?? LIVE_PICK_STYLES["BRONZE"]!;
            return (
              <div key={i} className={`rounded-lg border px-4 py-3 flex flex-col gap-2 ${st.border} ${st.bg}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono ${st.badge}`}>
                    #{i + 1} {pick.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {pick.confidencePct.toFixed(1)}% conf.
                  </span>
                </div>
                <div className={`font-mono font-bold text-2xl text-center ${st.score}`}>
                  {pick.home}–{pick.away}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Prob. placar</span>
                  <span className="font-mono">{(pick.prob * 100).toFixed(1)}%</span>
                </div>
                <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${i === 0 ? "bg-amber-400" : i === 1 ? "bg-zinc-400" : "bg-orange-500"}`}
                    style={{ width: `${Math.min(100, pick.prob * 100 * 8)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Market suggestions: BTTS + Over/Under + HT/FT */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-border/30">
          {/* BTTS */}
          <div className="rounded-lg border border-border/40 px-3 py-2.5 bg-muted/10">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ambas Marcam (BTTS)</p>
            {(() => {
              const p = result.bttsProb ?? 0;
              const rec = p >= 0.52 ? "SIM" : "NÃO";
              const conf = rec === "SIM" ? p : 1 - p;
              const color = rec === "SIM" ? "text-emerald-400" : "text-red-400";
              return (
                <div className="flex items-end justify-between">
                  <span className={`font-mono font-bold text-lg ${color}`}>{rec}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{(conf * 100).toFixed(1)}%</span>
                </div>
              );
            })()}
            <div className="mt-2 h-1 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${(result.bttsProb ?? 0) >= 0.52 ? "bg-emerald-400" : "bg-red-400"}`}
                style={{ width: `${Math.round(((result.bttsProb ?? 0) >= 0.52 ? result.bttsProb ?? 0 : 1 - (result.bttsProb ?? 0)) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">M79 estrutural + Monte Carlo</p>
          </div>

          {/* Over/Under */}
          <div className="rounded-lg border border-border/40 px-3 py-2.5 bg-muted/10">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Over/Under Gols</p>
            <div className="space-y-1.5">
              {(result.overUnderSuggestions ?? []).slice(0, 3).map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[10px] font-mono">
                    <span className={`font-bold ${s.recommendation === "OVER" ? "text-emerald-400" : "text-red-400"}`}>
                      {s.recommendation}
                    </span>
                    <span className="text-muted-foreground ml-1">{s.line.toFixed(1)}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${s.recommendation === "OVER" ? "bg-emerald-400" : "bg-red-400"}`}
                        style={{ width: `${Math.round(s.prob * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{(s.prob * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* HT/FT */}
          <div className="rounded-lg border border-border/40 px-3 py-2.5 bg-muted/10">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Intervalo/Final (HT/FT)</p>
            <div className="space-y-1.5">
              {(result.htFtSuggestions ?? []).slice(0, 3).map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[10px]">
                    <span className="font-mono font-semibold text-primary">{s.ht}/{s.ft}</span>
                    <span className="text-muted-foreground ml-1 text-[9px]">{s.label}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${Math.round(s.prob * 100 * 4)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{(s.prob * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Estatísticas ao vivo da ESPN — só aparece quando dados reais estão disponíveis */}
        {result.isLive && result.liveStats && (() => {
          const s = result.liveStats!;
          const hasShots = (s.homeShots ?? 0) > 0 || (s.awayShots ?? 0) > 0;
          const hasXg = s.homeXg != null && s.awayXg != null;
          const hasPossession = s.homePossession != null && s.awayPossession != null;
          const hasRedCards = (s.homeRedCards ?? 0) > 0 || (s.awayRedCards ?? 0) > 0;
          const hasYellow = (s.homeYellowCards ?? 0) > 0 || (s.awayYellowCards ?? 0) > 0;
          if (!hasShots && !hasXg && !hasPossession) return null;

          const totalShots = (s.homeShots ?? 0) + (s.awayShots ?? 0);
          const homeShotPct = totalShots > 0 ? ((s.homeShots ?? 0) / totalShots) * 100 : 50;

          const totalOnTarget = (s.homeShotsOnTarget ?? 0) + (s.awayShotsOnTarget ?? 0);
          const homeOnTgtPct = totalOnTarget > 0 ? ((s.homeShotsOnTarget ?? 0) / totalOnTarget) * 100 : 50;

          const totalXg = (s.homeXg ?? 0) + (s.awayXg ?? 0);
          const homeXgPct = totalXg > 0 ? ((s.homeXg ?? 0) / totalXg) * 100 : 50;

          return (
            <div className="pt-1 border-t border-border/30 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Estatísticas ao Vivo · ESPN
                </p>
                <span className="text-[9px] text-muted-foreground/50">dados reais</span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[10px]">
                <p className="font-semibold text-[11px] truncate">{result.homeTeam}</p>
                <p className="font-semibold text-[11px] truncate text-right">{result.awayTeam}</p>
              </div>

              {/* xG */}
              {hasXg && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-muted-foreground uppercase tracking-wide">
                    <span className="font-mono font-semibold text-primary">{(s.homeXg!).toFixed(2)} xG</span>
                    <span>Gols Esperados (xG)</span>
                    <span className="font-mono font-semibold text-primary">{(s.awayXg!).toFixed(2)} xG</span>
                  </div>
                  <div className="h-2 bg-muted/40 rounded-full overflow-hidden flex">
                    <div className="h-full bg-blue-500/70 rounded-l-full transition-all" style={{ width: `${homeXgPct}%` }} />
                    <div className="h-full bg-rose-500/70 rounded-r-full transition-all" style={{ width: `${100 - homeXgPct}%` }} />
                  </div>
                </div>
              )}

              {/* Finalizações totais */}
              {hasShots && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-muted-foreground uppercase tracking-wide">
                    <span className="font-mono font-semibold">{s.homeShots ?? 0}</span>
                    <span>Finalizações</span>
                    <span className="font-mono font-semibold">{s.awayShots ?? 0}</span>
                  </div>
                  <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden flex">
                    <div className="h-full bg-blue-400/60 rounded-l-full transition-all" style={{ width: `${homeShotPct}%` }} />
                    <div className="h-full bg-rose-400/60 rounded-r-full transition-all" style={{ width: `${100 - homeShotPct}%` }} />
                  </div>
                </div>
              )}

              {/* Chutes no gol */}
              {hasShots && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-muted-foreground uppercase tracking-wide">
                    <span className="font-mono font-semibold">{s.homeShotsOnTarget ?? 0}</span>
                    <span>No Gol</span>
                    <span className="font-mono font-semibold">{s.awayShotsOnTarget ?? 0}</span>
                  </div>
                  <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden flex">
                    <div className="h-full bg-emerald-500/60 rounded-l-full transition-all" style={{ width: `${homeOnTgtPct}%` }} />
                    <div className="h-full bg-orange-500/60 rounded-r-full transition-all" style={{ width: `${100 - homeOnTgtPct}%` }} />
                  </div>
                </div>
              )}

              {/* Posse de bola */}
              {hasPossession && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-muted-foreground uppercase tracking-wide">
                    <span className="font-mono font-semibold">{(s.homePossession!).toFixed(0)}%</span>
                    <span>Posse</span>
                    <span className="font-mono font-semibold">{(s.awayPossession!).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden flex">
                    <div className="h-full bg-violet-500/60 rounded-l-full transition-all" style={{ width: `${s.homePossession!}%` }} />
                    <div className="h-full bg-amber-500/60 rounded-r-full transition-all" style={{ width: `${s.awayPossession!}%` }} />
                  </div>
                </div>
              )}

              {/* Cartões */}
              {(hasRedCards || hasYellow) && (
                <div className="flex gap-4 pt-0.5">
                  {hasYellow && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-3 h-4 rounded-sm bg-yellow-400 inline-block" />
                      <span className="text-muted-foreground">{s.homeYellowCards ?? 0} / {s.awayYellowCards ?? 0}</span>
                    </div>
                  )}
                  {hasRedCards && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="w-3 h-4 rounded-sm bg-red-500 inline-block" />
                      <span className="text-red-400 font-semibold">{s.homeRedCards ?? 0} / {s.awayRedCards ?? 0}</span>
                      <span className="text-[9px] text-muted-foreground">expulsão — ajuste M55 aplicado</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Bookmaker odds panel — only when ODDS_API_KEY is configured */}
        {result.bettingMarkets && <BookmakerPanel bm={result.bettingMarkets} />}

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-3 pt-1 border-t border-border/30">
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Assertividade</p>
            <p className="font-mono text-sm font-semibold text-primary">{(result.assertiveness * 100).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Convergência</p>
            <p className="font-mono text-sm">{(result.convergence * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Z-Score</p>
            <p className="font-mono text-sm">{result.zScore.toFixed(1)}σ</p>
          </div>
        </div>

        <p className="text-[9px] text-muted-foreground/50">
          {isLive
            ? `Recalibrado às ${new Date(result.recalibratedAt).toLocaleTimeString("pt-BR")} · 80 motores · Markov ao vivo · BTTS M79 · HT/FT Poisson`
            : `Analisado às ${new Date(result.recalibratedAt).toLocaleTimeString("pt-BR")} · 80 motores · BTTS M79 · HT/FT Poisson · Odds mercado integradas`}
        </p>
      </div>
    </motion.div>
  );
}

export function LiveGameCard({ game }: { game: LiveGameOut }) {
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

  return (
    <div className="border border-red-500/25 rounded-xl overflow-hidden bg-red-500/3">
      <div className="px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          <span className="text-[9px] font-bold text-red-400 uppercase tracking-wide">
            AO VIVO {game.liveMinute}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70 shrink-0">{game.leagueName}</span>

        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm">{game.homeTeam}</span>
          <span className="mx-2 font-mono font-bold text-lg text-red-400">
            {game.liveHomeScore}–{game.liveAwayScore}
          </span>
          <span className="font-semibold text-sm">{game.awayTeam}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            onClick={() => {
              if (liveResult) { setLiveResult(null); return; }
              setLiveError(null);
              runLiveRecalibrate({ data: { fixtureId: game.fixtureId, leagueId: game.leagueId } });
            }}
            disabled={liveLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            {liveLoading ? (
              <>
                <span className="w-3 h-3 border border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                Recalibrando…
              </>
            ) : liveResult ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                Ocultar análise
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                Recalibrar ao Vivo
              </>
            )}
          </button>
        </div>
      </div>

      {liveError && (
        <div className="px-4 pb-2 text-[10px] text-destructive">{liveError}</div>
      )}

      <AnimatePresence>
        {liveResult && (
          <LiveRecalibratePanel result={liveResult} onClose={() => setLiveResult(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

export function AoVivoPanel() {
  const { data: rawGames, isLoading, dataUpdatedAt, refetch, isFetching } = useGetLiveGames({
    query: { refetchInterval: 30_000, queryKey: getGetLiveGamesQueryKey() },
  });
  // Guard against unexpected non-array shapes (e.g. error objects from the cache)
  const games = Array.isArray(rawGames) ? rawGames : [];

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")
    : null;

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${games.length > 0 ? "bg-red-400 animate-pulse" : "bg-muted-foreground/30"}`} />
          <span className="text-sm font-semibold">Ao Vivo Agora</span>
          {games.length > 0 && (
            <span className="text-[11px] font-mono text-red-400 bg-red-500/10 border border-red-500/25 px-1.5 py-0.5 rounded">
              {games.length} jogo{games.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-[10px] text-muted-foreground/50 font-mono hidden sm:inline">
              atualizado {lastUpdate}
            </span>
          )}
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors border border-border/40 px-2 py-0.5 rounded disabled:opacity-40"
          >
            {isFetching ? "atualizando…" : "↺ atualizar"}
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {isLoading && (
          <div className="py-6 text-center text-[11px] text-muted-foreground">
            <span className="animate-pulse">Verificando todas as ligas…</span>
          </div>
        )}

        {!isLoading && games.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhum jogo em andamento agora</p>
            <p className="text-[11px] text-muted-foreground/50 mt-1">
              Atualiza automaticamente a cada 30 s — 64 ligas monitoradas
            </p>
          </div>
        )}

        {games.map((game) => (
          <LiveGameCard key={game.fixtureId} game={game} />
        ))}
      </div>

      {games.length > 0 && (
        <div className="px-4 py-2 border-t border-border/30 text-[10px] text-muted-foreground/40">
          Recalibração usa todos os 110 métodos + placares em tempo real ESPN · atualiza a cada 30 s
        </div>
      )}
    </div>
  );
}
