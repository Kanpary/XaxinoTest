import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCalibrationMetrics } from "@workspace/api-client-react";

const NAV = [
  { href: "/", label: "Scanner" },
  { href: "/multipla", label: "Múltipla" },
  { href: "/historico", label: "Histórico" },
  { href: "/calibragem", label: "Calibragem" },
];

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
      {NAV.map(({ href, label }) => {
        const active = location === href;
        return (
          <Link
            key={href}
            href={href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              active
                ? "bg-white/8 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-white/4"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-48 border-r border-border/60 flex-col shrink-0">
        <div className="px-4 pt-5 pb-4 border-b border-border/60">
          <div className="text-xs font-semibold tracking-widest text-foreground/80 uppercase">Aposta Mestre</div>
          <div className="text-[10px] text-muted-foreground/60 mt-0.5 tracking-wide">Forensic Engine</div>
        </div>

        <NavLinks />

        <div className="px-4 py-4 border-t border-border/60 space-y-2.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Predições</span>
            <span className="font-mono text-foreground/70">{metrics?.totalPredictions ?? "—"}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Acerto exato</span>
            <span className="font-mono text-accent">
              {metrics ? `${(metrics.exactHitRate * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Mobile drawer */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-56 bg-background border-r border-border/60 flex flex-col md:hidden transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border/60">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase text-foreground/80">Aposta Mestre</div>
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">Forensic Engine</div>
          </div>
          <button onClick={() => setDrawerOpen(false)} className="p-1 rounded text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>
        <NavLinks />
        <div className="px-4 py-4 border-t border-border/60 space-y-2.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Predições</span>
            <span className="font-mono text-foreground/70">{metrics?.totalPredictions ?? "—"}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Acerto exato</span>
            <span className="font-mono text-accent">
              {metrics ? `${(metrics.exactHitRate * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        <header className="h-11 border-b border-border/60 flex items-center justify-between px-4 shrink-0">
          <button
            className="md:hidden p-1.5 rounded text-muted-foreground hover:text-foreground"
            onClick={() => setDrawerOpen(true)}
            aria-label="Menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect y="2" width="16" height="1.5" rx="0.75" />
              <rect y="7.25" width="16" height="1.5" rx="0.75" />
              <rect y="12.5" width="16" height="1.5" rx="0.75" />
            </svg>
          </button>
          <span className="md:hidden text-xs font-semibold tracking-widest uppercase text-foreground/80">Aposta Mestre</span>
          <div className="hidden md:flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="text-[11px] text-muted-foreground font-mono">online</span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            {time.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} BRT
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden flex border-t border-border/60 bg-background shrink-0">
          {NAV.map(({ href, label }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 py-3 text-center text-[11px] font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
