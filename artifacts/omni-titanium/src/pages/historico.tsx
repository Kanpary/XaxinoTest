import {
  useListPredictions,
  useGetCalibrationMetrics,
  getListPredictionsQueryKey,
  getGetCalibrationMetricsQueryKey,
  getGetModelParametersQueryKey,
} from "@workspace/api-client-react";
import { useMemo, useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AoVivoPanel } from "../components/LivePanel";

type Filter = "all" | "pending" | "resolved" | "hit_exact" | "hit_within_one" | "miss";

function apiStatusFor(f: Filter): "all" | "pending" | "resolved" {
  if (f === "pending") return "pending";
  if (f === "resolved" || f === "hit_exact" || f === "hit_within_one" || f === "miss") return "resolved";
  return "all";
}

interface SyncState {
  active: boolean;
  checked: number;
  resolved: number;
  total: number;
  current: string;
  lastScore?: string;
  error?: string;
}

const INITIAL_SYNC: SyncState = { active: false, checked: 0, resolved: 0, total: 0, current: "" };

export default function HistoricoPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [sync, setSyncState] = useState<SyncState>(INITIAL_SYNC);
  const esRef = useRef<EventSource | null>(null);
  const apiStatus = apiStatusFor(filter);

  const queryClient = useQueryClient();
  // Fetch all predictions (no date filter) for building the date selector list.
  const { data: allRaw = [], isLoading: loadingAll } = useListPredictions({ status: apiStatus, limit: 500 });
  // When a date is selected, re-fetch server-side filtered results for that specific date.
  const dateParams = { status: apiStatus, date: dateFilter || undefined, limit: 500 };
  const { data: dateRaw = [], isLoading: loadingDate } = useListPredictions(
    dateParams,
    { query: { enabled: Boolean(dateFilter), queryKey: getListPredictionsQueryKey(dateParams) } },
  );
  const isLoading = loadingAll || (Boolean(dateFilter) && loadingDate);
  const { data: metrics } = useGetCalibrationMetrics();

  const handleSync = useCallback(() => {
    if (sync.active) return;

    // Close any stale connection
    esRef.current?.close();

    setSyncState({ active: true, checked: 0, resolved: 0, total: 0, current: "Conectando…" });

    const es = new EventSource("/api/predictions/sync-results/stream");
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.type === "heartbeat") return;

        if (data.type === "progress") {
          setSyncState((prev) => ({
            ...prev,
            checked: data.checked,
            resolved: data.resolved,
            total: data.total,
            current: data.current,
            lastScore: data.score ?? prev.lastScore,
          }));
          // Invalidate predictions list in real-time so resolved ones move immediately
          if (data.score) {
            void queryClient.invalidateQueries({ queryKey: getListPredictionsQueryKey() });
          }
          return;
        }

        if (data.type === "done") {
          setSyncState({
            active: false,
            checked: data.checked,
            resolved: data.resolved,
            total: data.total ?? data.checked,
            current: `${data.resolved} resolvidos`,
          });
          es.close();
          void queryClient.invalidateQueries({ queryKey: getListPredictionsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetCalibrationMetricsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetModelParametersQueryKey() });
          return;
        }

        if (data.type === "error") {
          setSyncState((prev) => ({ ...prev, active: false, error: data.message }));
          es.close();
        }
      } catch { /* malformed JSON */ }
    };

    es.onerror = () => {
      setSyncState((prev) => ({
        ...prev,
        active: false,
        error: prev.checked === 0 ? "Falha ao conectar" : undefined,
      }));
      es.close();
      if (!sync.active) return;
      void queryClient.invalidateQueries({ queryKey: getListPredictionsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetCalibrationMetricsQueryKey() });
    };
  }, [sync.active, queryClient]);

  const availableDates = useMemo(() => {
    const dates = new Set<string>();
    allRaw.forEach((p) => { const d = p.matchDate ?? p.kickoffUtc?.slice(0, 10); if (d) dates.add(d); });
    return [...dates].sort((a, b) => b.localeCompare(a));
  }, [allRaw]);

  const predictions = useMemo(() => {
    // Use server-side date-filtered results when a date is selected, otherwise all results.
    let list = dateFilter ? dateRaw : allRaw;
    if (filter === "hit_exact") return list.filter((p) => (p.hitAnyExact ?? p.hitExact) === true);
    if (filter === "hit_within_one") return list.filter((p) => p.hitWithinOne === true && !(p.hitAnyExact ?? p.hitExact));
    if (filter === "miss") return list.filter((p) => !(p.hitAnyExact ?? p.hitExact) && !p.hitWithinOne && p.status === "resolved");
    return list;
  }, [allRaw, dateRaw, filter, dateFilter]);

  const counts = useMemo(() => {
    const exact = (metrics?.anyExactHitCount ?? metrics?.exactHitCount) ?? 0;
    const w1Total = metrics?.plusMinusOneHitCount ?? 0;
    const resolved = metrics?.resolvedCount ?? 0;
    return { exact, within1: w1Total - exact, miss: resolved - w1Total };
  }, [metrics]);

  const syncProgressPct = sync.total > 0 ? Math.round((sync.checked / sync.total) * 100) : null;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">

      {/* Live games panel */}
      <AoVivoPanel />

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Histórico</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {metrics?.resolvedCount ?? 0} resolvidos · {metrics?.totalPredictions ?? 0} total
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={sync.active}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border/60 rounded-md transition-colors disabled:opacity-50"
        >
          {sync.active ? (
            <><span className="w-3 h-3 border border-foreground/30 border-t-foreground rounded-full animate-spin" />Sincronizando…</>
          ) : "Sincronizar"}
        </button>
      </div>

      {/* Sync progress bar */}
      {(sync.active || sync.checked > 0) && (
        <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">
              {sync.active ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  {sync.current}
                </span>
              ) : (
                <span className="text-accent font-medium">✓ {sync.current}</span>
              )}
            </span>
            <span className="font-mono text-muted-foreground">
              {sync.checked}/{sync.total} · {sync.resolved} resolvidos
            </span>
          </div>

          {syncProgressPct !== null && (
            <div className="h-1 w-full bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${syncProgressPct}%` }}
              />
            </div>
          )}

          {sync.lastScore && (
            <p className="text-[10px] text-muted-foreground/70 font-mono">
              Último: {sync.current} → <span className="text-accent font-semibold">{sync.lastScore}</span>
            </p>
          )}

          {sync.error && (
            <p className="text-[11px] text-destructive">{sync.error}</p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="bg-muted/50 border border-border/60 rounded px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {dateFilter && (
            <button type="button" onClick={() => setDateFilter("")}
              className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 border border-border/40 rounded transition-colors">
              Todas as datas
            </button>
          )}
          {availableDates.slice(0, 8).map((d) => (
            <button key={d} type="button" onClick={() => setDateFilter(d === dateFilter ? "" : d)}
              className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                dateFilter === d ? "border-primary/50 bg-primary/8 text-primary" : "border-border/30 text-muted-foreground hover:border-border/60"
              }`}>
              {new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {(["all", "pending", "resolved"] as Filter[]).map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors ${
                filter === k ? "bg-foreground/8 text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              {k === "all" ? "Todos" : k === "pending" ? "Pendentes" : "Resolvidos"}
            </button>
          ))}
          <span className="w-px h-4 bg-border/50 mx-1 shrink-0" />
          {([
            { key: "hit_exact" as Filter, label: "Exato", count: counts.exact, color: "text-accent" },
            { key: "hit_within_one" as Filter, label: "Próximo", count: counts.within1, color: "text-amber-400" },
            { key: "miss" as Filter, label: "Erro", count: counts.miss, color: "text-destructive" },
          ]).map(({ key, label, count, color }) => (
            <button key={key} onClick={() => setFilter(filter === key ? "resolved" : key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md border whitespace-nowrap transition-colors ${
                filter === key ? `border-current ${color} bg-current/5` : "border-border/40 text-muted-foreground hover:text-foreground"
              }`}>
              {label}
              <span className={`font-mono font-semibold ${filter === key ? "" : "text-muted-foreground"}`}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-1.5">{[1,2,3,4].map((i) => <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />)}</div>
      ) : predictions.length === 0 ? (
        <div className="border border-border/40 border-dashed rounded-xl py-16 text-center">
          <p className="text-sm text-muted-foreground">Nenhum registro</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">Execute o scanner para gerar predições.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Data</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Jogo</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Liga</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Palpites (3)</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Assert.</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Converg.</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {predictions.map((p) => {
                  const hasResult = p.actualHome !== null && p.actualAway !== null;
                  const anyHit = p.hitAnyExact ?? p.hitExact ?? false;
                  const hit2 = p.hitExact2 ?? false;
                  const hit3 = p.hitExact3 ?? false;
                  const near = p.hitWithinOne && !anyHit;
                  return (
                    <tr key={p.id} className="hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {p.isLive && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                              <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />LIVE
                            </span>
                          )}
                          {p.matchDate ?? p.kickoffUtc?.slice(0, 10)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium">{p.homeTeam}</span>
                        <span className="text-muted-foreground/50 mx-1.5 text-xs">×</span>
                        <span className="text-sm font-medium">{p.awayTeam}</span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted-foreground max-w-[120px]">
                        <span className="truncate block">{p.leagueName}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <span className={`font-mono font-bold text-sm ${p.hitExact ? "text-accent" : "text-primary"}`}>
                            {p.primaryHome}–{p.primaryAway}
                          </span>
                          {p.pred2Home !== null && p.pred2Away !== null && (
                            <span className={`font-mono text-xs ${hit2 ? "text-accent font-semibold" : "text-muted-foreground"}`}>
                              / {p.pred2Home}–{p.pred2Away}
                            </span>
                          )}
                          {p.pred3Home !== null && p.pred3Away !== null && (
                            <span className={`font-mono text-xs ${hit3 ? "text-accent font-semibold" : "text-muted-foreground/60"}`}>
                              / {p.pred3Home}–{p.pred3Away}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-[11px] text-primary font-semibold">
                          {p.assertivenessReal != null ? `${(p.assertivenessReal * 100).toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {p.ensembleConvergence != null ? `${(p.ensembleConvergence * 100).toFixed(0)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {hasResult ? (
                          <div className="inline-flex items-center gap-2">
                            <span className={`font-mono font-bold text-sm ${
                              anyHit ? "text-accent" : near ? "text-amber-400" : "text-muted-foreground"
                            }`}>{p.actualHome}–{p.actualAway}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              anyHit ? "bg-accent/10 text-accent" : near ? "bg-amber-500/10 text-amber-400" : "bg-white/4 text-muted-foreground"
                            }`}>
                              {anyHit ? "✓" : near ? "~" : "✗"}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500/50" />pendente
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {predictions.map((p) => {
              const hasResult = p.actualHome !== null && p.actualAway !== null;
              const anyHit = p.hitAnyExact ?? p.hitExact ?? false;
              const near = p.hitWithinOne && !anyHit;
              const hit2 = p.hitExact2 ?? false;
              const hit3 = p.hitExact3 ?? false;
              return (
                <div key={p.id} className={`rounded-xl border px-4 py-3 flex flex-col gap-2 ${
                  anyHit ? "border-accent/20" : near ? "border-amber-500/20" : hasResult ? "border-border/30" : "border-border/40"
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {p.isLive && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                            <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />LIVE
                          </span>
                        )}
                        <p className="text-sm font-medium leading-snug truncate">{p.homeTeam} × {p.awayTeam}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{p.leagueName} · {p.matchDate ?? p.kickoffUtc?.slice(0, 10)}</p>
                    </div>
                    {hasResult ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`font-mono font-bold ${anyHit ? "text-accent" : near ? "text-amber-400" : "text-muted-foreground"}`}>
                          {p.actualHome}–{p.actualAway}
                        </span>
                        <span className={`text-[10px] font-bold ${anyHit ? "text-accent" : near ? "text-amber-400" : "text-muted-foreground/60"}`}>
                          {anyHit ? "✓" : near ? "~" : "✗"}
                        </span>
                      </div>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-amber-500/50 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-mono font-bold text-sm ${p.hitExact ? "text-accent" : "text-primary"}`}>
                      {p.primaryHome}–{p.primaryAway}
                    </span>
                    {p.pred2Home !== null && p.pred2Away !== null && (
                      <span className={`font-mono text-xs ${hit2 ? "text-accent font-semibold" : "text-muted-foreground"}`}>
                        · {p.pred2Home}–{p.pred2Away}
                      </span>
                    )}
                    {p.pred3Home !== null && p.pred3Away !== null && (
                      <span className={`font-mono text-xs ${hit3 ? "text-accent font-semibold" : "text-muted-foreground/60"}`}>
                        · {p.pred3Home}–{p.pred3Away}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 pt-0.5">
                    {p.assertivenessReal != null && (
                      <span className="text-[10px] text-muted-foreground">
                        Assert. <span className="font-mono text-primary font-semibold">{(p.assertivenessReal * 100).toFixed(1)}%</span>
                      </span>
                    )}
                    {p.ensembleConvergence != null && (
                      <span className="text-[10px] text-muted-foreground">
                        Conv. <span className="font-mono">{(p.ensembleConvergence * 100).toFixed(0)}%</span>
                      </span>
                    )}
                    {p.zScore != null && (
                      <span className="text-[10px] text-muted-foreground">
                        Z <span className="font-mono text-primary">{p.zScore.toFixed(1)}σ</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
