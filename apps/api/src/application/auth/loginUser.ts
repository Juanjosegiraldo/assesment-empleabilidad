import { unauthorized } from "../../domain/errors.js";
import type { AccessTokenClaims, AccessTokenService } from "../../domain/ports/AccessTokenService.js";
import type { PasswordHasher } from "../../domain/ports/PasswordHasher.js";
import type { RefreshTokenFactory } from "../../domain/ports/RefreshTokenFactory.js";
import type { RefreshTokenRepository } from "../../domain/ports/RefreshTokenRepository.js";
import type { UserRepository } from "../../domain/ports/UserRepository.js";
import type { User } from "../../domain/entities/User.js";

export type LoginDependencies = {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  accessTokens: AccessTokenService;
  refreshTokenFactory: RefreshTokenFactory;
};

export type LoginResult = {
  user: User;
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: Date;
};

/**
 * A bcrypt hash of a value nobody knows, used when the email does not exist.
 *
 * Without it, a request for an unknown email returns in a fraction of the time a real
 * one takes, because no hash gets verified. That difference is measurable, and it turns
 * the login endpoint into a way to find out who works here. Verifying against this
 * constant makes both paths cost the same.
 */
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.pJRD7Ck9PLKMbGvZ5cWJ5kK3Xy1O";

export async function loginUser(
  deps: LoginDependencies,
  input: { email: string; password: string },
): Promise<LoginResult> {
  const identity = await deps.users.findLoginIdentity(input.email);

  const passwordMatches = await deps.hasher.verify(
    input.password,
    identity?.passwordHash ?? DUMMY_HASH,
  );

  // One message for both failures. Saying "no such user" would confirm which addresses
  // are real.
  if (!identity || !passwordMatches) {
    throw unauthorized("Invalid email or password");
  }

  const claims: AccessTokenClaims = {
    userId: identity.id,
    fullName: identity.fullName,
    jobTitle: identity.jobTitle,
    locale: identity.locale,
  };

  const access = deps.accessTokens.issue(claims);
  const refresh = deps.refreshTokenFactory.create();

  await deps.refreshTokens.create({
    userId: identity.id,
    tokenHash: refresh.tokenHash,
    expiresAt: refresh.expiresAt,
    rotatedFromId: null,
  });

  return {
    user: {
      id: identity.id,
      email: identity.email,
      fullName: identity.fullName,
      jobTitle: identity.jobTitle,
      locale: identity.locale,
    },
    accessToken: access.token,
    expiresInSeconds: access.expiresInSeconds,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}
