import type { AccessTokenService } from "../../domain/ports/AccessTokenService.js";
import type { RefreshTokenFactory } from "../../domain/ports/RefreshTokenFactory.js";
import type { RefreshTokenRepository } from "../../domain/ports/RefreshTokenRepository.js";
import type { User } from "../../domain/entities/User.js";

export type RefreshDependencies = {
  refreshTokens: RefreshTokenRepository;
  accessTokens: AccessTokenService;
  refreshTokenFactory: RefreshTokenFactory;
};

/**
 * The outcome of an exchange, as data rather than as a thrown error.
 *
 * This shape exists for one specific reason, and it is worth understanding before
 * changing it.
 *
 * Detecting reuse has a side effect that MUST be persisted: every token of the account
 * gets revoked. If this use case threw on that path, the exception would travel out
 * through withoutActor, which rolls the transaction back, and the revocation would be
 * undone. The attack would be detected and then quietly forgiven.
 *
 * So reuse is a successful transaction with an unhappy outcome. The caller commits it and
 * then turns the outcome into a 401. Only "rotated" is a good result; everything else is
 * a refusal the HTTP layer renders.
 */
export type RefreshOutcome =
  | {
      status: "rotated";
      user: User;
      accessToken: string;
      expiresInSeconds: number;
      refreshToken: string;
      refreshExpiresAt: Date;
    }
  | { status: "unknown_token" }
  | { status: "expired" }
  | { status: "reuse_detected" };

export async function refreshSession(
  deps: RefreshDependencies,
  presentedToken: string,
): Promise<RefreshOutcome> {
  const tokenHash = deps.refreshTokenFactory.hash(presentedToken);
  const session = await deps.refreshTokens.findByHash(tokenHash);

  if (!session) {
    return { status: "unknown_token" };
  }

  // The token was already consumed by an earlier refresh, or logged out. Either the real
  // client replayed it, or somebody stole it and is racing the real user. There is no way
  // to tell from here, so assume theft: kill the whole family. The legitimate user signs
  // in again, the thief gets nothing.
  if (session.revokedAt !== null) {
    await deps.refreshTokens.revokeAllForUser(session.userId);
    return { status: "reuse_detected" };
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    return { status: "expired" };
  }

  // Rotation: the presented token is consumed and the replacement records where it came
  // from, which is what makes the chain, and therefore the detection above, possible.
  await deps.refreshTokens.revoke(session.tokenId);

  const rotated = deps.refreshTokenFactory.create();
  await deps.refreshTokens.create({
    userId: session.userId,
    tokenHash: rotated.tokenHash,
    expiresAt: rotated.expiresAt,
    rotatedFromId: session.tokenId,
  });

  const access = deps.accessTokens.issue({
    userId: session.userId,
    fullName: session.fullName,
    jobTitle: session.jobTitle,
    locale: session.locale,
  });

  return {
    status: "rotated",
    user: {
      id: session.userId,
      email: session.email,
      fullName: session.fullName,
      jobTitle: session.jobTitle,
      locale: session.locale,
    },
    accessToken: access.token,
    expiresInSeconds: access.expiresInSeconds,
    refreshToken: rotated.token,
    refreshExpiresAt: rotated.expiresAt,
  };
}
