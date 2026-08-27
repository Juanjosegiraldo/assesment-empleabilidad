/**
 * Composition root.
 *
 * The only file allowed to know about every layer at once. It builds the concrete
 * adapters and injects them, which is what lets the domain and the use cases depend on
 * interfaces instead of on pg, express, bcrypt or an AI SDK.
 *
 * Swapping an implementation is an edit here and nowhere else.
 */
import { config } from "./config.js";
import { createServer } from "./interfaces/http/server.js";
import { buildAuthRouter } from "./interfaces/http/routes/auth.js";
import { buildMessagingRouter } from "./interfaces/http/routes/messaging.js";
import { buildCopilotRouter } from "./interfaces/http/routes/copilot.js";
import { OpenAiCompatibleChatProvider } from "./infrastructure/ai/OpenAiCompatibleChatProvider.js";
import { OpenAiCompatibleEmbeddingProvider } from "./infrastructure/ai/OpenAiCompatibleEmbeddingProvider.js";
import { buildRequireAuth } from "./interfaces/http/middleware/requireAuth.js";
import { BcryptPasswordHasher } from "./infrastructure/security/BcryptPasswordHasher.js";
import { JwtAccessTokenService } from "./infrastructure/security/JwtAccessTokenService.js";
import { RandomRefreshTokenFactory } from "./infrastructure/security/RandomRefreshTokenFactory.js";
import { closePool, pool } from "./infrastructure/db/pool.js";

const hasher = new BcryptPasswordHasher();
const accessTokens = new JwtAccessTokenService(config.auth.jwtSecret, config.auth.accessTokenTtlSeconds);
const refreshTokenFactory = new RandomRefreshTokenFactory(config.auth.refreshTokenTtlDays);
const requireAuth = buildRequireAuth(accessTokens);

// The two AI adapters. This is the whole of the "the provider must be interchangeable"
// requirement: the classes implement ports the domain declares, and nothing above this
// file names them.
const chat = new OpenAiCompatibleChatProvider(config.ai.chat, config.ai.chat.model);
const embeddings = new OpenAiCompatibleEmbeddingProvider(
  config.ai.embeddings,
  config.ai.embeddings.model,
  config.ai.embeddings.dimensions,
);

const app = createServer([
  buildAuthRouter({ hasher, accessTokens, refreshTokenFactory, requireAuth }),
  buildMessagingRouter(requireAuth),
  buildCopilotRouter({ embeddings, chat, requireAuth }),
]);

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
