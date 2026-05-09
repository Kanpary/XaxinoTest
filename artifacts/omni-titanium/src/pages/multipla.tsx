import { useState, useMemo } from "react";
import {
  useGetParlaysuggestion,
  useListLeagues,
  useSaveParlay,
  useListParlays,
  useResolveParlay,
  useDeleteParlay,
} from "@workspace/api-client-react";
import type { ParlayOut, ParlayOption, ParlayLeg } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { AoVivoPanel } from "../components/LivePanel";
import { useQueryClient } from "@tanstack/react-query";
import { getListParlaysQueryKey } from "@workspace/api-client-react";

const CONFIDENCE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ALTA:  { bg: "bg-emerald-500/10",  text: "text-emerald-400",  border: "border-emerald-500/40" },
  MÉDIA: { bg: "bg-amber-500/10",    text: "text-amber-400",    border: "border-amber-500/40"   },
  BAIXA: { bg: "bg-zinc-500/10",     text: "text-zinc-400",     border: "border-zinc-500/40"    },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  pending:   { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30",    label: "Pendente"   },
  hit:       { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/40", label: "✓ Acerto"   },
  near_miss: { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/40",   label: "≈ Quase"    },
  miss:      { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/40",    label: "✗ Errou"    },
  resolved:  { bg: "bg-zinc-500/10",    text: "text-zinc-400",    border: "border-zinc-500/30",    label: "Resolvido"  },
};

const PICK_TYPE_LABELS: Record<string, string> = {
  exact_score: "Placar exato",
  btts: "Ambas marcam",
  over_under: "Over/Under",
  "1x2": "1X2",
};

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function LegCard({ leg, rank }: { leg: ParlayLeg; rank: number }) {
  const tripleSignal = leg.markovAgrees && leg.hawkesAgrees;
  return (
    <div className={`rounded-lg border px-4 py-3 space-y-2 ${tripleSignal ? "border-primary/40 bg-primary/4" : "border-border/50 bg-muted/10"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0">#{rank}</span>
            <span className="text-[10px] text-muted-foreground truncate">{leg.leagueName}</span>
          </div>
          <p className="text-sm font-semibold truncate">
            {leg.homeTeam} <span className="text-muted-foreground">×</span> {leg.awayTeam}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono font-bold text-lg text-primary">{leg.pick}</div>
          <div className="text-[10px] text-muted-foreground">{PICK_TYPE_LABELS[leg.pickType] ?? leg.pickType}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="bg-muted/30 rounded px-2 py-1 text-center">
          <div className="text-muted-foreground mb-0.5">Prob.</div>
          <div className="font-mono font-semibold">{(leg.prob * 100).toFixed(1)}%</div>
        </div>
        <div className="bg-muted/30 rounded px-2 py-1 text-center">
          <div className="text-muted-foreground mb-0.5">Odd justa</div>
          <div className="font-mono font-semibold">@{leg.fairOdd.toFixed(2)}</div>
        </div>
        <div className="bg-muted/30 rounded px-2 py-1 text-center">
          <div className="text-muted-foreground mb-0.5">Conv.</div>
          <div className="font-mono font-semibold">{(leg.convergence * 100).toFixed(0)}%</div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {leg.markovAgrees && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/25">Markov ✓</span>
        )}
        {leg.hawkesAgrees && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/25">Hawkes ✓</span>
        )}
        {tripleSignal && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25 font-semibold">Triple Lock</span>
        )}
        <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono">
          {leg.kickoffBrasilia.replace("T", " ").slice(0, 16)} BRT
        </span>
      </div>
      <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${Math.min(100, leg.prob * 100 * 5)}%` }} />
      </div>
    </div>
  );
}

function ParlayOptionCard({
  option, isRecommended, expanded, onToggle, onSave, isSaving,
}: {
  option: ParlayOption;
  isRecommended: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSave?: () => void;
  isSaving?: boolean;
}) {
  const conf = CONFIDENCE_COLORS[option.confidenceLabel] ?? CONFIDENCE_COLORS["BAIXA"]!;
  return (
    <div className={`rounded-xl border overflow-hidden ${isRecommended ? "border-primary/40" : "border-border/50"}`}>
      <button
        className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors hover:bg-muted/20 ${isRecommended ? "bg-primary/5" : ""}`}
        onClick={onToggle}
      >
        {isRecommended && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${isRecommended ? "text-primary" : "text-foreground"}`}>{option.label}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${conf.bg} ${conf.text} ${conf.border}`}>
              {option.confidenceLabel}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{option.note}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-bold text-foreground">@{option.combinedFairOdd.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{(option.jointProb * 100).toFixed(2)}% conjunto</div>
        </div>
        <span className="text-muted-foreground/50 text-lg leading-none shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
              <div className="grid grid-cols-3 gap-2 text-center text-[11px] mb-3">
                <div className="bg-muted/30 rounded px-2 py-2">
                  <div className="text-muted-foreground text-[9px] mb-1">Prob. conjunta</div>
                  <div className="font-mono font-bold text-sm">{(option.jointProb * 100).toFixed(2)}%</div>
                </div>
                <div className="bg-muted/30 rounded px-2 py-2">
                  <div className="text-muted-foreground text-[9px] mb-1">Odd justa</div>
                  <div className="font-mono font-bold text-sm text-primary">@{option.combinedFairOdd.toFixed(2)}</div>
                </div>
                <div className="bg-muted/30 rounded px-2 py-2">
                  <div className="text-muted-foreground text-[9px] mb-1">Jogos</div>
                  <div className="font-mono font-bold text-sm">{option.legs.length}</div>
                </div>
              </div>
              <div className="space-y-2">
                {option.legs.map((leg, i) => (
                  <LegCard key={leg.fixtureId} leg={leg} rank={i + 1} />
                ))}
              </div>
              {onSave && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSave(); }}
                  disabled={isSaving}
                  className="w-full mt-2 px-3 py-2 text-xs font-medium rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                >
                  {isSaving ? "Salvando…" : "↓ Salvar no histórico"}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryTab() {
  const qc = useQueryClient();
  const { data: historyRaw, isLoading } = useListParlays();
  const history = Array.isArray(historyRaw) ? historyRaw : [];
  const { mutateAsync: resolveParlay } = useResolveParlay();
  const { mutateAsync: deleteParlay } = useDeleteParlay();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resolveForm, setResolveForm] = useState<{ parlayId: string; hitLegs: number; nearMissLegs: number } | null>(null);

  const handleResolve = async () => {
    if (!resolveForm) return;
    setResolvingId(resolveForm.parlayId);
    try {
      await resolveParlay({ data: resolveForm });
      await qc.invalidateQueries({ queryKey: getListParlaysQueryKey() });
      setResolveForm(null);
    } finally {
      setResolvingId(null);
    }
  };

  const handleDelete = async (parlayId: string) => {
    setDeletingId(parlayId);
    try {
      await deleteParlay({ parlayId });
      await qc.invalidateQueries({ queryKey: getListParlaysQueryKey() });
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <span className="text-sm text-muted-foreground">Carregando histórico…</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="border border-border/40 border-dashed rounded-xl py-16 text-center">
        <p className="text-sm text-muted-foreground">Nenhuma múltipla salva</p>
        <p className="text-[11px] text-muted-foreground/50 mt-1">Gere uma múltipla e clique em "Salvar no histórico".</p>
      </div>
    );
  }

  const hitCount = history.filter((h) => h.status === "hit").length;
  const nearMissCount = history.filter((h) => h.status === "near_miss").length;
  const totalResolved = history.filter((h) => h.status !== "pending").length;

  return (
    <div className="space-y-4">
      {totalResolved > 0 && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-3">
            <div className="text-lg font-mono font-bold text-emerald-400">{hitCount}</div>
            <div className="text-[10px] text-muted-foreground">Acertos</div>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-3">
            <div className="text-lg font-mono font-bold text-amber-400">{nearMissCount}</div>
            <div className="text-[10px] text-muted-foreground">Quase certos</div>
          </div>
          <div className="bg-muted/20 border border-border/40 rounded-xl px-3 py-3">
            <div className="text-lg font-mono font-bold text-foreground">{totalResolved > 0 ? `${((hitCount / totalResolved) * 100).toFixed(0)}%` : "—"}</div>
            <div className="text-[10px] text-muted-foreground">Taxa de acerto</div>
          </div>
        </div>
      )}

      {resolveForm && (
        <div className="border border-primary/30 rounded-xl p-4 bg-primary/5 space-y-3">
          <p className="text-sm font-semibold">Registrar resultado</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Pernas acertadas</label>
              <input
                type="number"
                min={0}
                max={10}
                value={resolveForm.hitLegs}
                onChange={(e) => setResolveForm({ ...resolveForm, hitLegs: Number(e.target.value) })}
                className="w-full mt-1 bg-muted/40 border border-border/50 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">±1 gol (quase)</label>
              <input
                type="number"
                min={0}
                max={10}
                value={resolveForm.nearMissLegs}
                onChange={(e) => setResolveForm({ ...resolveForm, nearMissLegs: Number(e.target.value) })}
                className="w-full mt-1 bg-muted/40 border border-border/50 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleResolve()}
              disabled={resolvingId === resolveForm.parlayId}
              className="flex-1 px-3 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {resolvingId === resolveForm.parlayId ? "Salvando…" : "Confirmar resultado"}
            </button>
            <button
              onClick={() => setResolveForm(null)}
              className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground border border-border/40 rounded-md"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {history.map((item) => {
          const legs = (() => { try { return JSON.parse(item.legsJson) as ParlayLeg[]; } catch { return []; } })();
          const sc = STATUS_COLORS[item.status] ?? STATUS_COLORS["pending"]!;
          const conf = CONFIDENCE_COLORS[item.confidenceLabel] ?? CONFIDENCE_COLORS["BAIXA"]!;
          return (
            <div key={item.parlayId} className="border border-border/50 rounded-xl overflow-hidden">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold">{item.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${sc.bg} ${sc.text} ${sc.border}`}>{sc.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${conf.bg} ${conf.text} ${conf.border}`}>{item.confidenceLabel}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span>{item.date}</span>
                    <span className="font-mono">@{item.combinedFairOdd.toFixed(2)} · {(item.jointProb * 100).toFixed(2)}%</span>
                    <span>{item.totalLegs} jogos</span>
                    {item.hitLegs != null && (
                      <span className={item.status === "hit" ? "text-emerald-400" : "text-amber-400"}>
                        {item.hitLegs}/{item.totalLegs} acertos
                      </span>
                    )}
                  </div>
                  {legs.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {legs.map((leg, i) => (
                        <div key={i} className="text-[10px] text-muted-foreground/70 font-mono truncate">
                          {i + 1}. {leg.homeTeam} × {leg.awayTeam} — <span className="text-primary/80">{leg.pick}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {item.status === "pending" && (
                    <button
                      onClick={() => setResolveForm({ parlayId: item.parlayId, hitLegs: 0, nearMissLegs: 0 })}
                      className="text-[10px] px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                    >
                      Resultado
                    </button>
                  )}
                  <button
                    onClick={() => void handleDelete(item.parlayId)}
                    disabled={deletingId === item.parlayId}
                    className="text-[10px] px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors disabled:opacity-50"
                  >
                    {deletingId === item.parlayId ? "…" : "Apagar"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MultiplaPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"gerar" | "historico">("gerar");
  const [savingOption, setSavingOption] = useState<string | null>(null);

  const { data: leaguesRaw } = useListLeagues();
  const leagues = Array.isArray(leaguesRaw) ? leaguesRaw : [];
  const { mutateAsync: getParlay } = useGetParlaysuggestion();
  const { mutateAsync: saveParlay } = useSaveParlay();
  const qc = useQueryClient();

  const [parlay, setParlay] = useState<ParlayOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allLeagueIds = useMemo(() => leagues.map((l) => l.id), [leagues]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setParlay(null);
    try {
      const result = (await getParlay({
        data: { leagueIds: selected.length > 0 ? selected : undefined, date, minEdge: 0, minConvergence: 0.68 },
      })) as unknown as ParlayOut;
      setParlay(result);
      setExpandedIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar múltipla");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOption = async (option: ParlayOption) => {
    setSavingOption(option.label);
    try {
      await saveParlay({
        data: {
          date: parlay?.date ?? date,
          label: option.label,
          legsJson: JSON.stringify(option.legs),
          jointProb: option.jointProb,
          combinedFairOdd: option.combinedFairOdd,
          confidenceLabel: option.confidenceLabel,
          totalLegs: option.legs.length,
        },
      });
      await qc.invalidateQueries({ queryKey: getListParlaysQueryKey() });
    } finally {
      setSavingOption(null);
    }
  };

  const allOptions = useMemo(() => {
    if (!parlay) return [];
    const opts: Array<{ option: ParlayOption; isRecommended: boolean }> = [];
    if (parlay.recommended) opts.push({ option: parlay.recommended, isRecommended: true });
    for (const alt of parlay.alternatives) opts.push({ option: alt, isRecommended: false });
    return opts;
  }, [parlay]);

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold">Múltipla Sugerida</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            110 modelos · Markov + Hawkes triple-lock · histórico de resultados
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50 gap-4">
        {(["gerar", "historico"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "gerar" ? "Gerar múltipla" : "Histórico"}
          </button>
        ))}
      </div>

      {activeTab === "historico" && <HistoryTab />}

      {activeTab === "gerar" && (
        <>
          {/* Controls */}
          <div className="border border-border/50 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                O motor seleciona automaticamente as melhores oportunidades com
                <strong className="text-foreground"> convergência ≥ 68%</strong> e
                <strong className="text-foreground"> triple-lock Markov + Hawkes</strong>.
              </p>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="self-start sm:self-auto px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
              >
                {loading ? "Gerando…" : "Gerar múltipla"}
              </button>
            </div>
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Data (BRT)</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-muted/40 border border-border/50 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Ligas — <span className="text-foreground font-mono normal-case">
                    {selected.length === 0 ? `${allLeagueIds.length} (todas)` : `${selected.length} selecionadas`}
                  </span>
                </label>
                {selected.length > 0 && (
                  <button
                    onClick={() => setSelected([])}
                    className="text-[11px] text-primary hover:text-primary/70 border border-primary/30 px-2 py-1 rounded"
                  >
                    Limpar filtro
                  </button>
                )}
              </div>
            </div>
          </div>

          <AoVivoPanel />

          {loading && (
            <div className="border border-border/50 rounded-xl px-4 py-6 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-sm text-muted-foreground">Executando 110 modelos para cada jogo…</span>
              </div>
              <p className="text-[11px] text-muted-foreground/60 text-center">Pode levar até 30 s.</p>
            </div>
          )}

          {error && !loading && (
            <div className="border border-destructive/30 rounded-xl px-4 py-4 bg-destructive/5">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !parlay && !error && (
            <div className="border border-border/40 border-dashed rounded-xl py-20 text-center">
              <p className="text-sm text-muted-foreground">Sem múltipla gerada</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">Clique em "Gerar múltipla" para analisar os jogos de hoje.</p>
            </div>
          )}

          {!loading && parlay && (
            <div className="space-y-3">
              <div className="px-4 py-2.5 bg-muted/20 border border-border/40 rounded-lg flex flex-wrap gap-x-5 gap-y-1 items-center text-[11px]">
                <span className="text-muted-foreground">{parlay.date}</span>
                <span><span className="text-muted-foreground">Candidatos </span><span className="font-mono font-semibold">{parlay.totalCandidates}</span></span>
                <span><span className="text-muted-foreground">Sugestões </span><span className="font-mono font-semibold text-primary">{allOptions.length}</span></span>
                <span className="text-muted-foreground/50 font-mono ml-auto">{new Date(parlay.generatedAt).toLocaleTimeString("pt-BR")}</span>
              </div>

              {allOptions.length === 0 && (
                <div className="border border-border/40 border-dashed rounded-xl py-12 text-center">
                  <p className="text-sm text-muted-foreground">Nenhuma múltipla elegível para {parlay.date}</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">Tente outra data ou aguarde mais jogos.</p>
                </div>
              )}

              <div className="space-y-3">
                {allOptions.map(({ option, isRecommended }, idx) => (
                  <ParlayOptionCard
                    key={option.label}
                    option={option}
                    isRecommended={isRecommended}
                    expanded={expandedIdx === idx}
                    onToggle={() => setExpandedIdx(expandedIdx === idx ? -1 : idx)}
                    onSave={() => void handleSaveOption(option)}
                    isSaving={savingOption === option.label}
                  />
                ))}
              </div>

              <div className="px-4 py-3 border border-border/30 rounded-lg bg-muted/10 text-[10px] text-muted-foreground/60 space-y-1">
                <p><span className="font-semibold text-muted-foreground">Odds justas</span> são estimativas do motor (1/probabilidade), não odds de bookmakers.</p>
                <p><span className="font-semibold text-muted-foreground">Triple Lock</span> = placar confirmado pelo ensemble (110 métodos), Markov e Hawkes.</p>
                <p>Aposta responsável: jogue apenas o que pode perder.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
