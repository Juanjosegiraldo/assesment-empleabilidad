import type { Locale } from "../entities/User.js";

/** A stored refresh token together with the account it belongs to. */
export type RefreshSession = {
  tokenId: number;
  userId: number;
  expiresAt: Date;
  /** Non null means the token has already been used or logged out. */
  revokedAt: Date | null;
  email: string;
  fullName: string;
  jobTitle: string;
  locale: Locale;
};

export interface RefreshTokenRepository {
  /** Looked up by hash: the raw token is never stored, so it cannot be looked up by value. */
  findByHash(tokenHash: string): Promise<RefreshSession | null>;
  create(input: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
    rotatedFromId: number | null;
  }): Promise<number>;
  revoke(tokenId: number): Promise<void>;
  /** Used when reuse is detected: the whole family of tokens for the account is killed. */
  revokeAllForUser(userId: number): Promise<void>;
}
