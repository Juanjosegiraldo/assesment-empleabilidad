import { createHash, randomBytes } from "node:crypto";
import type { RefreshTokenFactory } from "../../domain/ports/RefreshTokenFactory.js";

/**
 * Refresh tokens are 32 random bytes, stored as a SHA-256 digest.
 *
 * Why SHA-256 and not bcrypt, when passwords use bcrypt
 * ----------------------------------------------------
 * bcrypt is slow on purpose, because a human password has little entropy and has to be
 * made expensive to guess. This token has 256 bits of entropy from the system random
 * source: there is no dictionary to run against it, and no cost factor would make
 * brute force less impossible than it already is.
 *
 * What hashing does buy here is that a database dump contains no usable tokens. And
 * SHA-256 is fast, which matters because every refresh performs a lookup by hash.
 */
export class RandomRefreshTokenFactory implements RefreshTokenFactory {
  constructor(private readonly ttlDays: number) {}

  create(): { token: string; tokenHash: string; expiresAt: Date } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);
    return { token, tokenHash: this.hash(token), expiresAt };
  }

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
