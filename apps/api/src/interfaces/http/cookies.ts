import type { Response } from "express";

export const REFRESH_COOKIE = "rw_refresh";

const isProduction = process.env.NODE_ENV === "production";

/**
 * The refresh cookie.
 *
 * httpOnly   script on the page cannot read it, so an XSS bug cannot steal the session
 * sameSite   the browser does not attach it to cross site requests, which blocks CSRF
 *            against the refresh endpoint
 * secure     HTTPS only, relaxed in development because localhost is plain HTTP
 * path       only sent to the auth endpoints, so it never travels with ordinary API calls
 */
const baseOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: isProduction,
  path: "/auth",
} as const;

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}
