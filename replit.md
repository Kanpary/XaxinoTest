# Score Oracle

Football match score prediction engine with 80 professional methods — exact-score hints for Live and Pre-Game matches.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- GitHub sync: run `bash scripts/github-sync.sh` to push to https://github.com/Kanpary/XaxinoTest (requires `GITHUB_TOKEN` secret)
- GitHub sync one-time setup: run `bash scripts/setup-github-sync.sh` to install the post-commit auto-push hook

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080)
- DB: PostgreSQL + Drizzle ORM (predictions, elo, model-state tables)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind + Wouter + TanStack Query

## Where things live

- `artifacts/api-server/src/engine/scanner.ts` — 80-method prediction engine (source of truth)
- `artifacts/api-server/src/services/live-recalibration-service.ts` — live recalibration + data crossing
- `artifacts/api-server/src/services/prediction-service.ts` — prediction storage, sync, resolution
- `artifacts/api-server/src/services/parlay-service.ts` — múltipla/parlay suggestion logic
- `artifacts/api-server/src/data-sources/espn.ts` — ESPN scoreboard + fixtures + past results
- `artifacts/api-server/src/routes/` — Express routers (scanner, predictions, leagues, calibration)
- `artifacts/omni-titanium/src/` — React frontend (ScannerPage, MultiplaPage, HistoricoPage, CalibragemPage)
- `artifacts/omni-titanium/src/pages/multipla.tsx` — Múltipla Sugerida page (parlay UI)
- `lib/db/src/schema/index.ts` — DB schema (predictions, elo, model-state)
- `lib/api-spec/` — OpenAPI spec + Orval codegen

## Architecture decisions

- **80-method ensemble**: Dixon-Coles, Bivariate Poisson, Monte Carlo (up to 120k iterations), Borda Count rank aggregation, Meta-Ensemble stacking, Scoreline Patterns, shot quality/xG, Hawkes process, live Markov projection.
- **Data crossing**: after all model matrices are computed, a cross-model consensus amplifier boosts scores that appear consistently in multiple independent model families (weighted presence ratio + meta-ensemble + scoreline prior + H2H + Markov).
- **Live recalibration**: re-runs the full engine with remaining-time lambdas (remFrac × full-game rate), then cross-validates top3 picks against Markov remaining-goals projection AND Hawkes momentum projection for triple-signal convergence.
- **1st-half HT/FT fix**: live 1st-half games now use remaining-time Poisson in remaining-goals space (not full-game final scores) to compute HT probability, conditioned on current score.
- **Past-date resolution**: `syncResultsStreaming` now falls back to `fetchFixturesForDate` (team-schedule reconstruction) when `fetchScoreboard` returns 0 events for past dates.
- **Date-scoped sync**: `syncResultsStreaming` accepts `{ date }` to restrict resolution to a single matchDate (avoids touching other days' pending rows).

## Product

- **Scanner**: displays live and today's pre-game matches across 64 leagues; each fixture can be scanned for exact-score predictions.
- **Múltipla**: generates parlay suggestions (2–5 legs) ranked by joint probability and Markov/Hawkes triple-lock agreement. POST `/api/scanner/parlay`.
- **Histórico**: lists saved predictions with resolution status (hit rates, ±1 goal, BTTS, O/U).
- **Calibragem**: shows calibration metrics (Brier score, log-loss, ROI) and lets the user trigger result sync.

## User preferences

- Language: Portuguese (BR) in the frontend UI, English in code and comments.
- GitHub repo: https://github.com/Kanpary/XaxinoTest — sync via `bash scripts/github-sync.sh`; token must be in `GITHUB_TOKEN` Replit secret (never hardcoded).

## Gotchas

- `topN` from `scanner.ts` is always in FINAL-score space (live offsets applied at return): `c.home + liveOffsetHome`. Do not add offsets again.
- `syncResultsStreaming` date filter: pass `{ date: "YYYY-MM-DD" }` to restrict to a single day.
- `fetchScoreboard` returns 0 events for past dates — always use `fetchFixturesForDate` as fallback for historical resolution.
- `git push` to GitHub: use `GIT_TOKEN="$GITHUB_TOKEN" git -c "credential.helper=!f() { echo username=x-access-token; echo \"password=\$GIT_TOKEN\"; }; f" push -f https://github.com/Kanpary/XaxinoTest.git HEAD:main` — direct push without modifying `.git/config` (which is locked by Replit's sandbox).
- Port is controlled by `PORT` env var (set by workflow); never hard-code 3000 or 8080 in Vite/Express config.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
