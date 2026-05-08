import {
  useGetCalibrationMetrics,
  useGetModelParameters,
  useRecalibrateModel,
  getGetCalibrationMetricsQueryKey,
  getGetModelParametersQueryKey,
  getListPredictionsQueryKey,
} from "@workspace/api-client-react";
import { AoVivoPanel } from "../components/LivePanel";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface RecalibrationResult {
  predictionsUsed?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  brierBefore?: number;
  brierAfter?: number;
  notes?: string[];
  error?: string;
}

export default function CalibragemPage() {
  const { data: metrics } = useGetCalibrationMetrics();
  const { data: params } = useGetModelParameters();
  const { mutateAsync: recalibrate, isPending } = useRecalibrateModel();
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<RecalibrationResult | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  const handleRecalibrate = async () => {
    setLastResult(null);
    const result = (await recalibrate()) as unknown as RecalibrationResult;
    setLastResult(result);
    await queryClient.invalidateQueries({ queryKey: getGetCalibrationMetricsQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetModelParametersQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListPredictionsQueryKey() });
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto">

      {/* Live games panel */}
      <AoVivoPanel />

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">Calibragem</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {params?.lastRecalibration ? `Última: ${params.lastRecalibration.slice(0, 10)}` : "Sem calibragem anterior"}
          </p>
        </div>
        <button
          onClick={handleRecalibrate}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Calibrando…</>
          ) : "Recalibrar"}
        </button>
      </div>

      {/* Result */}
      {lastResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          lastResult.error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-accent/20 bg-accent/5"
        }`}>
          {lastResult.error ? (
            <p className="text-xs">{lastResult.error}</p>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-accent">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  Concluído · {lastResult.predictionsUsed} predições
                  {lastResult.brierBefore != null && lastResult.brierAfter != null && (
                    <span className="text-muted-foreground font-normal ml-1">
                      Brier {lastResult.brierBefore.toFixed(3)} → {lastResult.brierAfter.toFixed(3)}
                    </span>
                  )}
                </div>
                {lastResult.notes && lastResult.notes.length > 0 && (
                  <button onClick={() => setShowNotes(v => !v)}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    {showNotes ? "Ocultar notas" : "Ver notas"}
                  </button>
                )}
              </div>
              {showNotes && lastResult.notes && (
                <ul className="mt-2.5 space-y-1 font-mono text-[10px] text-muted-foreground overflow-x-auto">
                  {lastResult.notes.map((n, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-border shrink-0">›</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metric cards */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Total", value: metrics.totalPredictions, mono: false },
            { label: "Resolvidas", value: `${metrics.resolvedCount}`, sub: `${metrics.pendingCount} pendentes`, mono: false },
            { label: "Acerto exato", value: `${((metrics.anyExactHitRate ?? metrics.exactHitRate) * 100).toFixed(1)}%`, sub: `${metrics.anyExactHitCount ?? metrics.exactHitCount} acertos`, accent: true },
            { label: "Próximo (±1)", value: `${((metrics.plusMinusOneHitRate - (metrics.anyExactHitRate ?? metrics.exactHitRate)) * 100).toFixed(1)}%`, sub: `${metrics.plusMinusOneHitCount - (metrics.anyExactHitCount ?? metrics.exactHitCount)} próximos` },
          ].map(({ label, value, sub, accent }) => (
            <div key={label} className="rounded-xl border border-border/50 p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-2xl font-semibold tabular-nums mt-1.5 ${accent ? "text-accent" : "text-foreground"}`}>{value}</p>
              {sub && <p className="text-[10px] text-muted-foreground/60 mt-1">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Chart + params */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border/50 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-4">Tendência de acertos</p>
          <div className="h-[200px]">
            {metrics?.recentTrend && metrics.recentTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.recentTrend}>
                  <XAxis dataKey="bucketLabel" stroke="transparent" fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis stroke="transparent" fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={30} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                  />
                  <Line type="monotone" dataKey="exactRate" name="Exato" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="plusMinusOneRate" name="±1" stroke="hsl(var(--accent))" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-muted-foreground">Dados insuficientes</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border/50 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-4">Parâmetros</p>
          {params ? (
            <div className="space-y-3">
              {[
                { label: "Dixon-Coles τ", value: params.dixonColesTau.toFixed(4) },
                { label: "Form decay ξ", value: params.weightedFormXi.toFixed(4) },
                { label: "Bivariate ρ", value: params.bivariateRho.toFixed(4) },
                { label: "Home advantage", value: params.homeAdvantage.toFixed(4) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground">{label}</span>
                  <span className="font-mono text-[11px]">{value}</span>
                </div>
              ))}

              <div className="pt-3 border-t border-border/40">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2.5">Pesos ensemble</p>
                <div className="space-y-2">
                  {[
                    { label: "Dixon-Coles", value: params.ensembleWeights.dixonColes, color: "bg-primary" },
                    { label: "Bivariate", value: params.ensembleWeights.bivariatePoisson, color: "bg-accent" },
                    { label: "Elo-Poisson", value: params.ensembleWeights.eloPoisson, color: "bg-destructive/70" },
                    { label: "Form", value: params.ensembleWeights.weightedForm, color: "bg-muted-foreground" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono">{(value * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Carregando…</p>
          )}
        </div>
      </div>

      {/* League performance */}
      {metrics && (metrics.bestLeague || metrics.worstLeague) && (
        <div className="grid grid-cols-2 gap-3">
          {metrics.bestLeague && (
            <div className="rounded-xl border border-accent/20 bg-accent/4 p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Melhor liga</p>
              <p className="text-sm font-medium text-accent mt-1.5">{metrics.bestLeague}</p>
            </div>
          )}
          {metrics.worstLeague && (
            <div className="rounded-xl border border-border/50 p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Pior liga</p>
              <p className="text-sm font-medium mt-1.5">{metrics.worstLeague}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
