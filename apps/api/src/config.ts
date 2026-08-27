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

export const config = {
  port: optionalNumber("API_PORT", 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  database: {
    // The API connects as rw_app, never as the owner. rw_app has NOBYPASSRLS, so the
    // row level security policies apply to everything this process does.
    url: required("DATABASE_URL"),
    poolSize: optionalNumber("DATABASE_POOL_SIZE", 10),
  },
} as const;
