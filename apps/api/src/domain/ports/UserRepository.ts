import type { Locale, User } from "../entities/User.js";

/**
 * A user's credentials, as needed by the sign in flow and nowhere else.
 *
 * This is the only type in the domain that carries a password hash, and it exists so the
 * hash never has to be attached to the User entity that the rest of the system passes
 * around.
 */
export type LoginIdentity = {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string;
  jobTitle: string;
  locale: Locale;
};

export interface UserRepository {
  /** Pre authentication lookup. Returns null when the email is unknown or deactivated. */
  findLoginIdentity(email: string): Promise<LoginIdentity | null>;
  findById(id: number): Promise<User | null>;
}
