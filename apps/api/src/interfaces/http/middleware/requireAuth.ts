import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../../../domain/errors.js";
import type { AccessTokenClaims, AccessTokenService } from "../../../domain/ports/AccessTokenService.js";

declare global {
  namespace Express {
    interface Request {
      /**
       * The authenticated user, taken from the verified token.
       *
       * This is the only place an identity enters the system. No route reads a user id
       * from a path parameter, a query string or a request body, so no request can act
       * as somebody else by asking nicely.
       */
      actor: AccessTokenClaims;
    }
  }
}

export function buildRequireAuth(accessTokens: AccessTokenService) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    const header = req.header("authorization");

    if (!header?.startsWith("Bearer ")) {
      throw unauthorized("Missing bearer token");
    }

    // verify throws DomainError("unauthorized") on anything wrong with the token, and
    // Express 5 forwards it to the error handler.
    req.actor = accessTokens.verify(header.slice("Bearer ".length).trim());
    next();
  };
}
