/**
 * Separate from AccessTokenService on purpose.
 *
 * A refresh token is an opaque random string, not a signed claim set. Nothing about
 * minting one has anything in common with signing a JWT, and a use case that rotates
 * refresh tokens has no business being handed the ability to issue access tokens.
 */
export interface RefreshTokenFactory {
  create(): { token: string; tokenHash: string; expiresAt: Date };
  /** Same hash the token was stored under, so a presented token can be looked up. */
  hash(token: string): string;
}
