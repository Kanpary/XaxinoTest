import { Router, type IRouter } from "express";
import { db, predictionsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { getModelState } from "../services/model-state-service";
import { computeMetrics, recalibrate } from "../services/calibration-service";
import type { ModelState } from "@workspace/db";

const router: IRouter = Router();

function serializeParameters(ms: ModelState) {
  return {
    dixonColesTau: ms.dixonColesTau,
    weightedFormXi: ms.weightedFormXi,
    bivariateRho: ms.bivariateRho,
    homeAdvantage: ms.homeAdvantage,
    ensembleWeights: {
      dixonColes: ms.weightDixonColes,
      bivariatePoisson: ms.weightBivariate,
      eloPoisson: ms.weightEloPoisson,
      weightedForm: ms.weightWeightedForm,
    },
    lastRecalibration: ms.lastRecalibration ? ms.lastRecalibration.toISOString() : null,
    predictionsSinceLastCalibration: ms.predictionsSinceLastCalibration,
    totalResolvedPredictions: ms.totalResolvedPredictions,
  };
}

router.get("/calibration/parameters", async (_req, res) => {
  const ms = await getModelState();
  res.json(serializeParameters(ms));
});

router.get("/calibration/metrics", async (req, res) => {
  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "resolved"));
  const resolved = Number(totalRow[0]?.count ?? 0);
  const pendingRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(predictionsTable)
    .where(eq(predictionsTable.status, "pending"));
  const pending = Number(pendingRow[0]?.count ?? 0);
  const metrics = await computeMetrics(resolved + pending, pending);
  if (process.env.DEBUG_CALIBRATION) {
    req.log.info(
      {
        resolvedDb: resolved,
        pendingDb: pending,
        exactHitCount: metrics.exactHitCount,
        anyExactHitCount: metrics.anyExactHitCount,
        anyExactHitRate: metrics.anyExactHitRate,
        plusMinusOneHitCount: metrics.plusMinusOneHitCount,
        brierScore: metrics.brierScore,
      },
      "calibration/metrics debug",
    );
  }
  res.json(metrics);
});

router.post("/calibration/recalibrate", async (req, res) => {
  try {
    const result = await recalibrate();
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      success: true,
      predictionsUsed: result.predictionsUsed,
      before: serializeParameters(result.before),
      after: serializeParameters(result.after),
      brierBefore: result.brierBefore,
      brierAfter: result.brierAfter,
      notes: result.notes,
    });
  } catch (err) {
    req.log.error({ err }, "Recalibration failed");
    res.status(500).json({ error: "Falha na recalibragem" });
  }
});

export default router;
