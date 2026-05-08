import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCalibrationMetrics } from "@workspace/api-client-react";

const NAV = [
  { href: "/",          label: "Scanner",    icon: "⬡" },
  { href: "/multipla",  label: "Múltipla",   icon: "◈" },
  { href: "/historico", label: "Histórico",  icon: "◉" },
  { href: "/calibragem",label: "Calibragem", icon: "◎" },
];

function Logo({ small }: { small?: boolean }) {
  return (
    <div className={small ? "flex items-center gap-2" : ""}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center glow-primary">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <polygon points="7,1 13,4.5 13,9.5 7,13 1,9.5 1,4.5" fill="hsl(262 83% 65% / 0.2)" stroke="hsl(262 83% 65%)" strokeWidth="1"/>
            <circle cx="7" cy="7" r="2" fill="hsl(262 83% 65%)" />
          </svg>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-wider uppercase gradient-text">Score Oracle</div>
          {!small && <div className="text-[9px] text-muted-foreground/50 tracking-widest uppercase">110 modelos · ESPN</div>}
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [time, setTime] = useState(new Date());
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { setDrawerOpen(false); }, [location]);

  const { data: metrics } = useGetCalibrationMetrics();

  const NavLinks = () => (
    <nav className="flex-1 px-2 py-3 space-y-0.5">
      {NAV.map(({ href, label, icon }) => {
        const active = location === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              active
                ? "bg-primary/12 text-primary border border-primary/25 glow-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-white/4 border border-transparent"
            }`}
          >
            <span className={`text-base leading-none ${active ? "text-primary" : "text-muted-foreground/60"}`}>{icon}</span>
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const StatsBlock = () => (
    <div className="px-3 py-3 mx-2 mb-2 rounded-xl border border-border/50 bg-muted/20 space-y-2">
      <div className="flex justify-between items-center text-[10px]">
        <span className="text-muted-foreground">Predições</span>
        <span className="font-mono font-semibold text-foreground/80">{metrics?.totalPredictions ?? "—"}</span>
      </div>
      <div className="flex justify-between items-center text-[10px]">
        <span className="text-muted-foreground">Acerto exato</span>
        <span className={`font-mono font-semibold ${metrics && metrics.exactHitRate > 0.08 ? "text-accent" : "text-muted-foreground"}`}>
          {metrics ? `${(metrics.exactHitRate * 100).toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="flex justify-between items-center text-[10px]">
        <span className="text-muted-foreground">±1 gol</span>
        <span className="font-mono text-primary">
          {metrics ? `${(metrics.plusMinusOneHitRate * 100).toFixed(1)}%` : "—"}
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-52 border-r border-border/50 flex-col shrink-0 bg-sidebar">
        {/* Brand */}
        <div className="px-4 pt-5 pb-4 border-b border-border/40">
          <Logo />
        </div>

        <NavLinks />

        <StatsBlock />

        {/* Status */}
        <div className="px-4 py-3 border-t border-border/40">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-[10px] text-muted-foreground font-mono">online · 64 ligas</span>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/80 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-56 bg-sidebar border-r border-border/50 flex flex-col md:hidden transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border/40">
          <Logo small />
          <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 text-lg leading-none">×</button>
        </div>
        <NavLinks />
        <StatsBlock />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Top bar */}
        <header className="h-12 border-b border-border/50 flex items-center justify-between px-4 shrink-0 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
              onClick={() => setDrawerOpen(true)}
              aria-label="Menu"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect y="2.5" width="16" height="1.5" rx="0.75" />
                <rect y="7.25" width="16" height="1.5" rx="0.75" />
                <rect y="12" width="16" height="1.5" rx="0.75" />
              </svg>
            </button>
            <span className="md:hidden text-[11px] font-bold tracking-wider uppercase gradient-text">Score Oracle</span>
          </div>

          <div className="hidden md:flex items-center gap-4 text-[10px]">
            {/* current page label */}
            <span className="text-muted-foreground/60 font-mono">
              {NAV.find(n => n.href === location)?.label ?? ""}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="text-[10px] text-muted-foreground font-mono">online</span>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono tabular-nums">
              {time.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} BRT
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden flex border-t border-border/50 bg-sidebar shrink-0">
          {NAV.map(({ href, label, icon }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
