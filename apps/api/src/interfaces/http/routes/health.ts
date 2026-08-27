import { Router } from "express";
import { pool } from "../../../infrastructure/db/pool.js";

export const healthRouter: Router = Router();

/**
 * Liveness and readiness in one endpoint.
 *
 * It actually queries the database instead of returning a hardcoded "ok". A health check
 * that cannot fail tells you nothing, and docker compose uses this to decide when the
 * API is ready to receive traffic.
 */
healthRouter.get("/health", async (_req, res) => {
  const startedAt = process.hrtime.bigint();
  await pool.query("select 1");
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  res.json({
    status: "ok",
    database: { reachable: true, latencyMs: Number(latencyMs.toFixed(2)) },
    uptimeSeconds: Math.floor(process.uptime()),
  });
});
