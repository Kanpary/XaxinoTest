import { db, modelStateTable, type ModelState } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getModelState(): Promise<ModelState> {
  const rows = await db.select().from(modelStateTable).limit(1);
  if (rows.length > 0) return rows[0]!;
  // Initialize with defaults
  const inserted = await db
    .insert(modelStateTable)
    .values({})
    .returning();
  return inserted[0]!;
}

export async function updateModelState(
  patch: Partial<ModelState>,
): Promise<ModelState> {
  const current = await getModelState();
  const updated = await db
    .update(modelStateTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(modelStateTable.id, current.id))
    .returning();
  return updated[0]!;
}

export async function incrementSinceLastCalibration(n: number = 1): Promise<void> {
  const current = await getModelState();
  await db
    .update(modelStateTable)
    .set({
      predictionsSinceLastCalibration:
        current.predictionsSinceLastCalibration + n,
    })
    .where(eq(modelStateTable.id, current.id));
}
