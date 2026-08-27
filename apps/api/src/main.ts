/**
 * Composition root.
 *
 * This is the only file allowed to know about every layer at once. It builds the
 * concrete adapters and hands them to the layers above, which is what lets the domain
 * and the use cases depend on interfaces rather than on pg, express or an AI SDK.
 */
import { config } from "./config.js";
import { createServer } from "./interfaces/http/server.js";
import { closePool, pool } from "./infrastructure/db/pool.js";

const app = createServer();

// Fail before accepting traffic if the database is unreachable, rather than serving
// 500s until somebody notices.
await pool.query("select 1");

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ level: "info", message: `API listening on :${config.port}` }));
});

// Finish in flight requests and hand connections back before exiting, so a redeploy does
// not drop somebody's message halfway through.
const shutdown = (signal: string) => {
  console.log(JSON.stringify({ level: "info", message: `${signal} received, shutting down` }));
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
