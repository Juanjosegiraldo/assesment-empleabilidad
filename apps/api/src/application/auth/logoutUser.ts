import type { RefreshTokenFactory } from "../../domain/ports/RefreshTokenFactory.js";
import type { RefreshTokenRepository } from "../../domain/ports/RefreshTokenRepository.js";

export type LogoutDependencies = {
  refreshTokens: RefreshTokenRepository;
  refreshTokenFactory: RefreshTokenFactory;
};

/**
 * Revokes the presented refresh token.
 *
 * Deliberately silent about failure. Logging out with a token that is already gone is not
 * an error the caller can act on, and answering differently for a known and an unknown
 * token would turn logout into an oracle for testing whether a stolen token is still live.
 */
export async function logoutUser(
  deps: LogoutDependencies,
  presentedToken: string | undefined,
): Promise<void> {
  if (!presentedToken) return;

  const session = await deps.refreshTokens.findByHash(deps.refreshTokenFactory.hash(presentedToken));
  if (session && session.revokedAt === null) {
    await deps.refreshTokens.revoke(session.tokenId);
  }
}
