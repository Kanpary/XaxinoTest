import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { parlaysTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.post("/parlays", async (req, res) => {
  const body = req.body as {
    date?: string;
    label?: string;
    legsJson?: string;
    jointProb?: number;
    combinedFairOdd?: number;
    confidenceLabel?: string;
    totalLegs?: number;
  };
  if (!body.date || !body.label || !body.legsJson || body.jointProb == null || body.combinedFairOdd == null || !body.confidenceLabel || body.totalLegs == null) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  try {
    const parlayId = randomUUID();
    const [inserted] = await db.insert(parlaysTable).values({
      parlayId,
      date: body.date,
      label: body.label,
      generatedAt: new Date(),
      legsJson: body.legsJson,
      jointProb: body.jointProb,
      combinedFairOdd: body.combinedFairOdd,
      confidenceLabel: body.confidenceLabel,
      totalLegs: body.totalLegs,
      status: "pending",
    }).returning();
    res.json({ success: true, parlayId, id: inserted?.id });
  } catch (err) {
    req.log.error({ err }, "Save parlay failed");
    res.status(500).json({ error: "Falha ao salvar múltipla" });
  }
});

router.get("/parlays", async (req, res) => {
  try {
    const rows = await db.select().from(parlaysTable).orderBy(desc(parlaysTable.generatedAt)).limit(100);
    res.json(rows.map((p) => ({
      id: p.id,
      parlayId: p.parlayId,
      date: p.date,
      label: p.label,
      generatedAt: p.generatedAt.toISOString(),
      legsJson: p.legsJson,
      jointProb: p.jointProb,
      combinedFairOdd: p.combinedFairOdd,
      confidenceLabel: p.confidenceLabel,
      totalLegs: p.totalLegs,
      status: p.status,
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
      hitLegs: p.hitLegs ?? null,
      nearMissLegs: p.nearMissLegs ?? null,
      resultLabel: p.resultLabel ?? null,
      actualResultsJson: p.actualResultsJson ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "List parlays failed");
    res.status(500).json({ error: "Falha ao listar múltiplas" });
  }
});

router.post("/parlays/resolve", async (req, res) => {
  const body = req.body as {
    parlayId?: string;
    hitLegs?: number;
    nearMissLegs?: number;
    actualResultsJson?: string;
  };
  if (!body.parlayId || body.hitLegs == null || body.nearMissLegs == null) {
    res.status(400).json({ error: "Missing required fields: parlayId, hitLegs, nearMissLegs" });
    return;
  }
  const { parlayId, hitLegs, nearMissLegs, actualResultsJson } = body;

  try {
    const [existing] = await db.select().from(parlaysTable).where(eq(parlaysTable.parlayId, parlayId));
    if (!existing) {
      res.status(404).json({ error: "Múltipla não encontrada" });
      return;
    }

    const totalLegs = existing.totalLegs;
    let resultLabel: string;
    let status: string;

    if (hitLegs === totalLegs) {
      resultLabel = "hit";
      status = "hit";
    } else if (hitLegs >= Math.ceil(totalLegs * 0.6) || nearMissLegs > 0) {
      resultLabel = "near_miss";
      status = "near_miss";
    } else {
      resultLabel = "miss";
      status = "miss";
    }

    await db.update(parlaysTable)
      .set({
        status,
        resultLabel,
        hitLegs,
        nearMissLegs,
        resolvedAt: new Date(),
        actualResultsJson: actualResultsJson ?? null,
      })
      .where(eq(parlaysTable.parlayId, parlayId));

    res.json({ success: true, parlayId, status, resultLabel, hitLegs, nearMissLegs });
  } catch (err) {
    req.log.error({ err }, "Resolve parlay failed");
    res.status(500).json({ error: "Falha ao resolver múltipla" });
  }
});

router.delete("/parlays/:parlayId", async (req, res) => {
  const { parlayId } = req.params;
  try {
    await db.delete(parlaysTable).where(eq(parlaysTable.parlayId, parlayId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete parlay failed");
    res.status(500).json({ error: "Falha ao deletar múltipla" });
  }
});

export default router;
