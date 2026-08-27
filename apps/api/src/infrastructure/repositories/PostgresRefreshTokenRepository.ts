import type { DbClient } from "../db/pool.js";
import { isLocale } from "../../domain/entities/User.js";
import type { RefreshSession, RefreshTokenRepository } from "../../domain/ports/RefreshTokenRepository.js";

type SessionRow = {
  token_id: number;
  user_id: number;
  expires_at: Date;
  revoked_at: Date | null;
  email: string;
  full_name: string;
  job_title: string;
  locale: string;
};

export class PostgresRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly client: DbClient) {}

  async findByHash(tokenHash: string): Promise<RefreshSession | null> {
    const result = await this.client.query<SessionRow>(
      "select token_id, user_id, expires_at, revoked_at, email, full_name, job_title, locale from rw_find_refresh_session($1)",
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      tokenId: row.token_id,
      userId: row.user_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      email: row.email,
      fullName: row.full_name,
      jobTitle: row.job_title,
      locale: isLocale(row.locale) ? row.locale : "es",
    };
  }

  async create(input: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
    rotatedFromId: number | null;
  }): Promise<number> {
    const result = await this.client.query<{ id: number }>(
      `insert into rw_refresh_tokens (user_id, token_hash, expires_at, rotated_from_id)
       values ($1, $2, $3, $4)
       returning id`,
      [input.userId, input.tokenHash, input.expiresAt, input.rotatedFromId],
    );
    return result.rows[0]!.id;
  }

  async revoke(tokenId: number): Promise<void> {
    await this.client.query(
      "update rw_refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null",
      [tokenId],
    );
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.client.query(
      "update rw_refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
      [userId],
    );
  }
}
