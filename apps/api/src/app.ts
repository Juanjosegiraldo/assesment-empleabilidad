/**
 * Assembles the application without starting a server.
 *
 * Split out of main.ts so the tests can mount the real thing, with the real database and
 * the real policies behind it, and never open a port. Mocking the database here would
 * defeat the purpose: what these tests need to prove is that PostgreSQL refuses, and a
 * mock refuses whatever it was told to.
 */
import type { Express } from "express";
import { config } from "./config.js";
import { createServer } from "./interfaces/http/server.js";
import { buildAuthRouter } from "./interfaces/http/routes/auth.js";
import { buildMessagingRouter } from "./interfaces/http/routes/messaging.js";
import { buildCopilotRouter } from "./interfaces/http/routes/copilot.js";
import { buildStreamRouter } from "./interfaces/http/routes/stream.js";
import { buildDocsRouter } from "./interfaces/http/routes/docs.js";
import { buildRequireAuth } from "./interfaces/http/middleware/requireAuth.js";
import { BcryptPasswordHasher } from "./infrastructure/security/BcryptPasswordHasher.js";
import { JwtAccessTokenService } from "./infrastructure/security/JwtAccessTokenService.js";
import { RandomRefreshTokenFactory } from "./infrastructure/security/RandomRefreshTokenFactory.js";
import { OpenAiCompatibleChatProvider } from "./infrastructure/ai/OpenAiCompatibleChatProvider.js";
import { OpenAiCompatibleEmbeddingProvider } from "./infrastructure/ai/OpenAiCompatibleEmbeddingProvider.js";
import type { MessageNotifier } from "./infrastructure/realtime/MessageNotifier.js";

/**
 * Composition root.
 *
 * The only place that names concrete adapters. Everything above depends on the ports in
 * domain/, which is what makes swapping an implementation an edit to this file alone.
 */
export function buildApp(options: { notifier?: MessageNotifier } = {}): Express {
  const hasher = new BcryptPasswordHasher();
  const accessTokens = new JwtAccessTokenService(
    config.auth.jwtSecret,
    config.auth.accessTokenTtlSeconds,
  );
  const refreshTokenFactory = new RandomRefreshTokenFactory(config.auth.refreshTokenTtlDays);
  const requireAuth = buildRequireAuth(accessTokens);

  const chat = new OpenAiCompatibleChatProvider(config.ai.chat, config.ai.chat.model);
  const embeddings = new OpenAiCompatibleEmbeddingProvider(
    config.ai.embeddings,
    config.ai.embeddings.model,
    config.ai.embeddings.dimensions,
  );

  const routers = [
    buildDocsRouter(),
    buildAuthRouter({ hasher, accessTokens, refreshTokenFactory, requireAuth }),
    buildMessagingRouter(requireAuth),
    buildCopilotRouter({ embeddings, chat, requireAuth }),
  ];

  // The realtime stream needs a live LISTEN connection. Tests do not start one, so the
  // route is only mounted when a notifier is supplied.
  if (options.notifier) routers.push(buildStreamRouter(options.notifier, requireAuth));

  return createServer(routers);
}
