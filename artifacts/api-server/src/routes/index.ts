import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scannerRouter from "./scanner";
import predictionsRouter from "./predictions";
import leaguesRouter from "./leagues";
import calibrationRouter from "./calibration";
import parlaysRouter from "./parlays";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scannerRouter);
router.use(predictionsRouter);
router.use(leaguesRouter);
router.use(calibrationRouter);
router.use(parlaysRouter);

export default router;
