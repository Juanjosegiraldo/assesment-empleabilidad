import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { invalidInput, unauthorized } from "../../../domain/errors.js";
import { loginUser } from "../../../application/auth/loginUser.js";
import { logoutUser } from "../../../application/auth/logoutUser.js";
import { refreshSession } from "../../../application/auth/refreshSession.js";
import { withActor, withoutActor } from "../../../infrastructure/db/withActor.js";
import { PostgresRefreshTokenRepository } from "../../../infrastructure/repositories/PostgresRefreshTokenRepository.js";
import { PostgresUserRepository } from "../../../infrastructure/repositories/PostgresUserRepository.js";
import type { AccessTokenService } from "../../../domain/ports/AccessTokenService.js";
import type { PasswordHasher } from "../../../domain/ports/PasswordHasher.js";
import type { RefreshTokenFactory } from "../../../domain/ports/RefreshTokenFactory.js";
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from "../cookies.js";

/** What the client is told for each way a refresh can fail. */
const REFRESH_FAILURE_MESSAGE = {
  unknown_token: "Invalid session",
  expired: "Session expired, please sign in again",
  reuse_detected: "Session reuse detected, all sessions have been revoked",
} as const;

const loginSchema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(200),
});

export type AuthDependencies = {
  hasher: PasswordHasher;
  accessTokens: AccessTokenService;
  refreshTokenFactory: RefreshTokenFactory;
  requireAuth: RequestHandler;
};

export function buildAuthRouter(deps: AuthDependencies): Router {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw invalidInput("Email and password are required");
    }

    // withoutActor: nobody is authenticated yet, so there is no actor to pin. Any query
    // touching an RLS protected table inside this block fails loudly by design.
    const result = await withoutActor((client) =>
      loginUser(
        {
          users: new PostgresUserRepository(client),
          refreshTokens: new PostgresRefreshTokenRepository(client),
          hasher: deps.hasher,
          accessTokens: deps.accessTokens,
          refreshTokenFactory: deps.refreshTokenFactory,
        },
        parsed.data,
      ),
    );

    // The refresh token goes into an httpOnly cookie and never into the JSON body, so
    // script running on the page cannot read it. The access token does go in the body:
    // it is short lived and the client needs it for the Authorization header.
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);

    res.json({
      user: result.user,
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
    });
  });

  router.post("/auth/refresh", async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!presented) {
      throw invalidInput("No refresh cookie present");
    }

    // The transaction is committed before the outcome is inspected. That order matters:
    // on the reuse path the use case has just revoked every token of the account, and
    // throwing inside the transaction would roll that revocation back.
    const outcome = await withoutActor((client) =>
      refreshSession(
        {
          refreshTokens: new PostgresRefreshTokenRepository(client),
          accessTokens: deps.accessTokens,
          refreshTokenFactory: deps.refreshTokenFactory,
        },
        presented,
      ),
    );

    if (outcome.status !== "rotated") {
      // A stale cookie is worse than no cookie: the browser would keep replaying it and
      // keep tripping the reuse detector.
      clearRefreshCookie(res);
      throw unauthorized(REFRESH_FAILURE_MESSAGE[outcome.status]);
    }

    setRefreshCookie(res, outcome.refreshToken, outcome.refreshExpiresAt);

    res.json({
      user: outcome.user,
      accessToken: outcome.accessToken,
      expiresInSeconds: outcome.expiresInSeconds,
    });
  });

  router.post("/auth/logout", async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    await withoutActor((client) =>
      logoutUser(
        {
          refreshTokens: new PostgresRefreshTokenRepository(client),
          refreshTokenFactory: deps.refreshTokenFactory,
        },
        presented,
      ),
    );

    clearRefreshCookie(res);
    res.sendStatus(204);
  });

  router.get("/auth/me", deps.requireAuth, async (req, res) => {
    // The id comes from the token. Reading it inside withActor means the RLS policy on
    // rw_users applies even to a user reading their own profile.
    const user = await withActor(req.actor.userId, (client) =>
      new PostgresUserRepository(client).findById(req.actor.userId),
    );

    res.json({ user });
  });

  return router;
}
