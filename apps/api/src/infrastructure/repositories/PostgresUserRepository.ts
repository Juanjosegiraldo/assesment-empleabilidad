import type { DbClient } from "../db/pool.js";
import type { User } from "../../domain/entities/User.js";
import { isLocale } from "../../domain/entities/User.js";
import type { LoginIdentity, UserRepository } from "../../domain/ports/UserRepository.js";

type LoginRow = {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  job_title: string;
  locale: string;
};

type UserRow = Omit<LoginRow, "password_hash">;

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly client: DbClient) {}

  async findLoginIdentity(email: string): Promise<LoginIdentity | null> {
    // rw_find_login_identity is SECURITY DEFINER, and is the only path in the system
    // that reads a password hash. See 002_rls.sql for why it has to exist.
    const result = await this.client.query<LoginRow>(
      "select id, email, password_hash, full_name, job_title, locale from rw_find_login_identity($1)",
      [email],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      fullName: row.full_name,
      jobTitle: row.job_title,
      locale: isLocale(row.locale) ? row.locale : "es",
    };
  }

  async findById(id: number): Promise<User | null> {
    // No SECURITY DEFINER here: this runs inside withActor, so the RLS policy on
    // rw_users decides what is visible. An actor asking for somebody they share no
    // channel with gets nothing back.
    const result = await this.client.query<UserRow>(
      "select id, email, full_name, job_title, locale from rw_users where id = $1 and deleted_at is null",
      [id],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      jobTitle: row.job_title,
      locale: isLocale(row.locale) ? row.locale : "es",
    };
  }
}
