import jwt from "jsonwebtoken";
import { unauthorized } from "../../domain/errors.js";
import { isLocale } from "../../domain/entities/User.js";
import type { AccessTokenClaims, AccessTokenService } from "../../domain/ports/AccessTokenService.js";

/** The shape actually written into the JWT, using the registered claim names. */
type JwtPayload = {
  sub: string;
  name: string;
  job_title: string;
  locale: string;
};

export class JwtAccessTokenService implements AccessTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(claims: AccessTokenClaims): { token: string; expiresInSeconds: number } {
    const payload: JwtPayload = {
      sub: String(claims.userId),
      name: claims.fullName,
      job_title: claims.jobTitle,
      locale: claims.locale,
    };

    const token = jwt.sign(payload, this.secret, {
      algorithm: "HS256",
      expiresIn: this.ttlSeconds,
    });

    return { token, expiresInSeconds: this.ttlSeconds };
  }

  verify(token: string): AccessTokenClaims {
    let decoded: unknown;
    try {
      // The algorithm is pinned. Without it, a token signed with alg "none" or with a
      // weaker algorithm would be accepted, which is the classic JWT forgery.
      decoded = jwt.verify(token, this.secret, { algorithms: ["HS256"] });
    } catch {
      // Expired, tampered with, or signed by somebody else. The caller gets one answer.
      throw unauthorized("Invalid or expired token");
    }

    if (typeof decoded !== "object" || decoded === null) {
      throw unauthorized("Invalid token payload");
    }

    const payload = decoded as Partial<JwtPayload>;
    const userId = Number(payload.sub);

    if (!Number.isInteger(userId) || !payload.name || !payload.job_title || !isLocale(payload.locale)) {
      throw unauthorized("Invalid token payload");
    }

    return {
      userId,
      fullName: payload.name,
      jobTitle: payload.job_title,
      locale: payload.locale,
    };
  }
}
