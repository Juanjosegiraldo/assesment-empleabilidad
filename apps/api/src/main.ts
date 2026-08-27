/**
 * Process entry point: start the listener, wire shutdown, and get out of the way.
 * The wiring itself lives in app.ts so tests can build the same application.
 */
import { config } from "./config.js";
import { buildApp } from "./app.js";
import { closePool, pool } from "./infrastructure/db/pool.js";
import { MessageNotifier } from "./infrastructure/realtime/MessageNotifier.js";

// One connection LISTENing for the whole process, started before the server accepts
// traffic so no message inserted during boot is missed.
const notifier = new MessageNotifier();
await notifier.start();

const app = buildApp({ notifier });

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
    await notifier.stop();
    await closePool();
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
