/**
 * Shared setup for the integration tests.
 *
 * These run against the real, seeded database. Nothing is mocked, because what is under
 * test is whether PostgreSQL refuses: row level security policies and the checks inside
 * rw_send_message. A mocked database would only prove that the mock does what it was told.
 *
 * Every assertion below is read only or expected to fail, so the corpus is left exactly
 * as it was found. Run `npm run db:seed -- --reset` if it ever needs restoring.
 */
import request from "supertest";
import type { Express } from "express";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/db/pool.js";

/**
 * A separate owner connection, used only to look ids up for the fixtures.
 *
 * The first version of this file used the application pool for that and failed
 * immediately with "no actor pinned for this transaction", which is the security model
 * doing its job: rw_app cannot read rw_channels without somebody being pinned as the
 * actor. Test setup is an administrative task and has no actor, so it uses the owner
 * connection, exactly like the migrations and the seed loader do.
 */
const admin = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

export const SEED_PASSWORD = "Riwi2026*";

/** Belongs to three public channels and to neither private one. */
export const NON_MEMBER = "juan.jose.giraldo@riwi.io";
/** Belongs to Dirección Financiera, so she is the positive control. */
export const MEMBER = "daniela.pineda@riwi.io";

export const PRIVATE_CHANNEL_SLUG = "direccion-financiera";

export const app: Express = buildApp();

export async function signIn(email: string): Promise<string> {
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password: SEED_PASSWORD })
    .expect(200);

  return response.body.accessToken as string;
}

/** Channel ids are generated, so they are looked up rather than hardcoded. */
export async function channelIdBySlug(slug: string): Promise<number> {
  const result = await admin.query<{ id: number }>("select id from rw_channels where slug = $1", [slug]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Channel ${slug} not found. Run npm run db:seed first.`);
  return id;
}

export async function userIdByEmail(email: string): Promise<number> {
  const result = await admin.query<{ id: number }>(
    "select id from rw_users where lower(email) = lower($1) and deleted_at is null",
    [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`User ${email} not found. Run npm run db:seed first.`);
  return id;
}

export async function closeDatabase(): Promise<void> {
  await Promise.all([pool.end(), admin.end()]);
}
