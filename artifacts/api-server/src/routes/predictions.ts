import { Router, type IRouter } from "express";
import { ListPredictionsQueryParams } from "@workspace/api-zod";
import { listPredictions, syncResults, syncResultsStreaming } from "../services/prediction-service";
import type { Prediction } from "@workspace/db";

const router: IRouter = Router();

function serialize(p: Prediction) {
  return {
    id: p.id,
    fixtureId: p.fixtureId,
    leagueId: p.leagueId,
    leagueName: p.leagueName,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
    kickoffUtc: p.kickoffUtc.toISOString(),
    matchDate: p.matchDate ?? p.kickoffUtc.toISOString().slice(0, 10),
    primaryHome: p.primaryHome,
    primaryAway: p.primaryAway,
    primaryProb: p.primaryProb,
    hedgeScoresJson: p.hedgeScoresJson,
    topNScoresJson: p.topNScoresJson,
    assertivenessReal: p.assertivenessReal,
    ensembleConvergence: p.ensembleConvergence,
    currentOdd: p.currentOdd,
    fairValue: p.fairValue,
    edgePct: p.edgePct,
    zScore: p.zScore,
    verdict: p.verdict,
    forensicVerdict: p.forensicVerdict,
    motorsActivated: p.motorsActivated,
    xrayDriver: p.xrayDriver,
    status: p.status,
    actualHome: p.actualHome,
    actualAway: p.actualAway,
    hitExact: p.hitExact,
    hitExact2: p.hitExact2,
    hitExact3: p.hitExact3,
    hitAnyExact: p.hitAnyExact,
    hitWithinOne: p.hitWithinOne,
    pred2Home: p.pred2Home,
    pred2Away: p.pred2Away,
    pred2Prob: p.pred2Prob,
    pred3Home: p.pred3Home,
    pred3Away: p.pred3Away,
    pred3Prob: p.pred3Prob,
    isLive: p.isLive,
    liveMinute: p.liveMinute,
    liveHomeScore: p.liveHomeScore,
    liveAwayScore: p.liveAwayScore,
    createdAt: p.createdAt.toISOString(),
    resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
  };
}

router.get("/predictions", async (req, res) => {
  const parsed = ListPredictionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status, date, limit } = parsed.data;
  const rows = await listPredictions({ status, date, limit });
  res.json(rows.map(serialize));
});

/**
 * POST /api/predictions/sync-results
 * Non-streaming sync — fires and waits for all results.
 * Kept for backwards compatibility.
 */
router.post("/predictions/sync-results", async (req, res) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const result = await syncResultsStreaming(() => { /* no-op */ }, { date });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Sync results failed");
    res.status(500).json({ error: "Falha ao sincronizar resultados" });
  }
});

/**
 * GET /api/predictions/sync-results/stream
 * Server-Sent Events endpoint for real-time sync progress.
 *
 * Events:
 *   data: {"type":"progress","checked":N,"resolved":M,"total":T,"current":"Home × Away","fixtureId":"...","score":"1-0"}
 *   data: {"type":"done","checked":N,"resolved":M,"stillPending":P,"autoRecalibrated":B}
 */
router.get("/predictions/sync-results/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  req.on("close", () => { closed = true; });

  const sendEvent = (data: object) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  // Send a heartbeat immediately so client knows connection is live
  sendEvent({ type: "heartbeat" });

  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    await syncResultsStreaming(sendEvent, { date });
  } catch (err) {
    req.log.error({ err }, "SSE sync results failed");
    sendEvent({ type: "error", message: "Falha ao sincronizar resultados" });
  }

  if (!closed) {
    res.end();
  }
});

export default router;
