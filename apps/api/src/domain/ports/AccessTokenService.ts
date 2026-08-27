import type { Locale } from "../entities/User.js";

/**
 * What the access token carries.
 *
 * Name and job title travel in the token so the copilot can build its system prompt from
 * the server's own view of who is asking, without a round trip and without ever taking
 * an identity from the request body.
 */
export type AccessTokenClaims = {
  userId: number;
  fullName: string;
  jobTitle: string;
  locale: Locale;
};

export interface AccessTokenService {
  issue(claims: AccessTokenClaims): { token: string; expiresInSeconds: number };
  /** Throws a DomainError("unauthorized") when the token is invalid, expired or forged. */
  verify(token: string): AccessTokenClaims;
}
