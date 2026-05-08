import { Router, type IRouter } from "express";
import { RunScannerBody, LiveRecalibrateBody } from "@workspace/api-zod";
import { runScanner } from "../services/scanner-service";
import { liveRecalibrateFixture } from "../services/live-recalibration-service";
import { getLiveGames } from "../services/live-games-service";
import { buildParlaySuggestion, type ParlayCandidate } from "../services/parlay-service";

const router: IRouter = Router();

router.post("/scanner/run", async (req, res) => {
  const parsed = RunScannerBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  try {
    const result = await runScanner({
      leagueIds: body.leagueIds ?? undefined,
      date: body.date ?? undefined,
      minEdge: body.minEdge ?? undefined,
      minConvergence: body.minConvergence ?? undefined,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Scanner run failed");
    res.status(500).json({ error: "Falha interna no scanner" });
  }
});

router.get("/scanner/live-games", async (req, res) => {
  try {
    const games = await getLiveGames();
    res.json(games);
  } catch (err) {
    req.log.error({ err }, "Live games fetch failed");
    res.status(500).json({ error: "Falha ao buscar jogos ao vivo" });
  }
});

router.post("/scanner/live-recalibrate", async (req, res) => {
  const parsed = LiveRecalibrateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { fixtureId, leagueId } = parsed.data;
  try {
    const result = await liveRecalibrateFixture(fixtureId, leagueId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha na recalibração ao vivo";
    req.log.error({ err, fixtureId, leagueId }, "Live recalibration failed");
    if (message.includes("não encontrado") || message.includes("not found")) {
      res.status(404).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

// ── Parlay / Múltipla suggestion ─────────────────────────────────────────────
// Accepts the last scanner run body (same payload as /scanner/run) and derives
// the best parlay combination from the reports.
router.post("/scanner/parlay", async (req, res) => {
  const parsed = RunScannerBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  try {
    const scanResult = await runScanner({
      leagueIds: body.leagueIds ?? undefined,
      date: body.date ?? undefined,
      minEdge: body.minEdge ?? undefined,
      minConvergence: body.minConvergence ?? 0.68,
    });

    const candidates: ParlayCandidate[] = scanResult.reports.map((r) => ({
      fixtureId: r.fixtureId,
      leagueId: r.leagueId,
      leagueName: r.leagueName,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      kickoffBrasilia: r.kickoffBrasilia,
      verdict: r.verdict,
      primary: r.primary,
      convergence: r.ensembleConvergence,
      zScore: r.zScore,
      assertiveness: r.assertivenessReal,
      bttsProb: (r as any).scorelinePatterns?.bttsProb ?? r.mcStats?.bttsProb,
      mcStats: r.mcStats,
      liveMarkov: r.liveMarkov ?? null,
      hawkesAnalysis: r.hawkesAnalysis ?? null,
    }));

    const parlay = buildParlaySuggestion(candidates, scanResult.date);
    res.json(parlay);
  } catch (err) {
    req.log.error({ err }, "Parlay suggestion failed");
    res.status(500).json({ error: "Falha ao gerar múltipla sugerida" });
  }
});

export default router;
