import bcrypt from "bcryptjs";
import type { PasswordHasher } from "../../domain/ports/PasswordHasher.js";

/**
 * bcrypt at cost 10.
 *
 * The cost factor is the point of bcrypt: it makes each guess expensive, so an attacker
 * with a stolen dump cannot try a dictionary at hardware speed. 10 is roughly 60ms on
 * this hardware, slow enough to matter and fast enough that a login does not feel laggy.
 *
 * The database refuses anything that is not a bcrypt digest, so this class is not the
 * only thing standing between the system and a plain text password.
 */
export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds = 10) {}

  hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.rounds);
  }

  verify(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }
}
