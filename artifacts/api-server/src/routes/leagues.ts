import { Router, type IRouter } from "express";
import { ListLeaguesResponse } from "@workspace/api-zod";
import { LEAGUES } from "../data-sources/leagues";

const router: IRouter = Router();

router.get("/leagues", (_req, res) => {
  const data = ListLeaguesResponse.parse(
    LEAGUES.map((l) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      espnSlug: l.espnSlug,
      active: l.active,
      confederation: l.confederation,
    })),
  );
  res.json(data);
});

export default router;
