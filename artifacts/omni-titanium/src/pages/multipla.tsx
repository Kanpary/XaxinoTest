import { useState, useMemo } from "react";
import { useGetParlaysuggestion, useListLeagues } from "@workspace/api-client-react";
import type { ParlayOut, ParlayOption, ParlayLeg } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { AoVivoPanel } from "../components/LivePanel";

const CONFIDENCE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ALTA:  { bg: "bg-emerald-500/10",  text: "text-emerald-400",  border: "border-emerald-500/40" },
  MÉDIA: { bg: "bg-amber-500/10",    text: "text-amber-400",    border: "border-amber-500/40"   },
  BAIXA: { bg: "bg-zinc-500/10",     text: "text-zinc-400",     border: "border-zinc-500/40"    },
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
          <div className="text-muted-foreground mb-0.5">Convergência</div>
          <div className="font-mono font-semibold">{(leg.convergence * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {leg.markovAgrees && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/25">
            Markov ✓
          </span>
        )}
        {leg.hawkesAgrees && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/25">
            Hawkes ✓
          </span>
        )}
        {tripleSignal && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25 font-semibold">
            Triple Lock
          </span>
        )}
        <span className="text-[9px] text-muted-foreground/50 ml-auto font-mono">
          {leg.kickoffBrasilia.replace("T", " ").slice(0, 16)} BRT
        </span>
      </div>

      <div className="h-1 bg-muted/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/60 transition-all"
          style={{ width: `${Math.min(100, leg.prob * 100 * 5)}%` }}
        />
      </div>
    </div>
  );
}

function ParlayOptionCard({
  option,
  isRecommended,
  expanded,
  onToggle,
}: {
  option: ParlayOption;
  isRecommended: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const conf = CONFIDENCE_COLORS[option.confidenceLabel] ?? CONFIDENCE_COLORS["BAIXA"]!;

  return (
    <div className={`rounded-xl border overflow-hidden ${isRecommended ? "border-primary/40" : "border-border/50"}`}>
      <button
        className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors hover:bg-muted/20 ${isRecommended ? "bg-primary/5" : ""}`}
        onClick={onToggle}
      >
        {isRecommended && (
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${isRecommended ? "text-primary" : "text-foreground"}`}>
              {option.label}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${conf.bg} ${conf.text} ${conf.border}`}>
              {option.confidenceLabel}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{option.note}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-bold text-foreground">
            @{option.combinedFairOdd.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {(option.jointProb * 100).toFixed(2)}% conjunto
          </div>
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
                  <div className="text-muted-foreground text-[9px] mb-1">Odd justa combinada</div>
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MultiplaPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number>(0);

  const { data: leagues = [] } = useListLeagues();
  const { mutateAsync: getParlay } = useGetParlaysuggestion();
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
      const msg = err instanceof Error ? err.message : "Falha ao gerar múltipla";
      setError(msg);
    } finally {
      setLoading(false);
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
      <div className="border border-border/50 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-sm font-semibold">Múltipla Sugerida</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Combinação automática · 80 métodos · Markov + Hawkes triple-lock
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="self-start sm:self-auto px-4 py-2 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
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
                Limpar filtro de ligas
              </button>
            )}
          </div>
        </div>

        <div className="px-4 pb-4">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            O motor seleciona automaticamente as melhores oportunidades do dia com base em:
            <strong className="text-foreground"> convergência ≥ 68%</strong>,
            <strong className="text-foreground"> acordo Markov + Hawkes</strong> (triple-lock),
            e maximiza a probabilidade conjunta.
            São propostas até 3 combinações — dupla segura, múltipla recomendada (3 jogos) e agressiva (4–5 jogos).
          </p>
        </div>
      </div>

      {/* Live panel */}
      <AoVivoPanel />

      {/* Loading */}
      {loading && (
        <div className="border border-border/50 rounded-xl px-4 py-6 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm text-muted-foreground">
              Executando varredura e analisando combinações…
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground/60 text-center">
            O motor roda todos os 80 métodos para cada jogo elegível antes de sugerir a múltipla.
            Pode levar até 30 s.
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="border border-destructive/30 rounded-xl px-4 py-4 bg-destructive/5">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !parlay && !error && (
        <div className="border border-border/40 border-dashed rounded-xl py-20 text-center">
          <p className="text-sm text-muted-foreground">Sem múltipla gerada</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            Clique em "Gerar múltipla" para analisar os jogos de hoje.
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && parlay && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="px-4 py-2.5 bg-muted/20 border border-border/40 rounded-lg flex flex-wrap gap-x-5 gap-y-1 items-center text-[11px]">
            <span className="text-muted-foreground">{parlay.date}</span>
            <span>
              <span className="text-muted-foreground">Candidatos analisados </span>
              <span className="font-mono font-semibold">{parlay.totalCandidates}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Combinações sugeridas </span>
              <span className="font-mono font-semibold text-primary">{allOptions.length}</span>
            </span>
            <span className="text-muted-foreground/50 font-mono ml-auto">
              {new Date(parlay.generatedAt).toLocaleTimeString("pt-BR")}
            </span>
          </div>

          {/* No eligible games */}
          {allOptions.length === 0 && (
            <div className="border border-border/40 border-dashed rounded-xl py-12 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma múltipla elegível para {parlay.date}</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                O motor não encontrou combinações com convergência ≥ 68%.
                Tente outra data ou aguarde mais jogos serem adicionados.
              </p>
            </div>
          )}

          {/* Options */}
          <div className="space-y-3">
            {allOptions.map(({ option, isRecommended }, idx) => (
              <ParlayOptionCard
                key={option.label}
                option={option}
                isRecommended={isRecommended}
                expanded={expandedIdx === idx}
                onToggle={() => setExpandedIdx(expandedIdx === idx ? -1 : idx)}
              />
            ))}
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-3 border border-border/30 rounded-lg bg-muted/10 text-[10px] text-muted-foreground/60 space-y-1">
            <p>
              <span className="font-semibold text-muted-foreground">Odds justas</span> são estimativas do motor (1/probabilidade),
              não odds de bookmakers. Compare com as odds disponíveis antes de apostar.
            </p>
            <p>
              <span className="font-semibold text-muted-foreground">Triple Lock</span> = placar confirmado simultaneamente pelo
              motor ensemble (80 métodos), Markov ao vivo e processo de Hawkes — maior sinal de convergência.
            </p>
            <p>
              Aposta responsável: jogue apenas o que pode perder.
              Probabilidade conjunta indica o risco real da múltipla.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
