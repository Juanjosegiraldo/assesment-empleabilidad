import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// One .env at the repository root, shared by the database scripts, the API and compose.
// Two copies of the same credentials drift, and drifted credentials are debugged at 2am.
loadEnv({ path: resolve(import.meta.dirname, "../../../.env") });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    // Fail at boot, not on the first request that happens to need this variable.
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
};

const optionalNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} is not a number.`);
  return parsed;
};

/** Accepts "900", "15m", "2h" or "7d" and returns seconds. */
const durationToSeconds = (raw: string): number => {
  const match = /^(\d+)([smhd]?)$/.exec(raw.trim());
  if (!match) throw new Error(`Invalid duration "${raw}". Use 900, 15m, 2h or 7d.`);
  const amount = Number(match[1]);
  const multiplier = { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? ""] ?? 1;
  return amount * multiplier;
};

export const config = {
  port: optionalNumber("API_PORT", 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  auth: {
    jwtSecret: required("JWT_SECRET"),
    // Short lived on purpose. An access token cannot be revoked once issued, so the
    // window in which a stolen one is useful has to be small. Continuity comes from the
    // refresh token, which can be revoked.
    accessTokenTtlSeconds: durationToSeconds(process.env.ACCESS_TOKEN_TTL ?? "15m"),
    refreshTokenTtlDays: optionalNumber("REFRESH_TOKEN_TTL_DAYS", 7),
  },
  database: {
    // The API connects as rw_app, never as the owner. rw_app has NOBYPASSRLS, so the
    // row level security policies apply to everything this process does.
    url: required("DATABASE_URL"),
    poolSize: optionalNumber("DATABASE_POOL_SIZE", 10),
  },
} as const;
