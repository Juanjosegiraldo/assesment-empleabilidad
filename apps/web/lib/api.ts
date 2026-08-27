/**
 * The browser side API client.
 *
 * Two things it is responsible for, and one it deliberately is not.
 *
 * It holds the access token in a module variable, in memory only. Never in localStorage:
 * anything readable by script is readable by an XSS payload, and a token in localStorage
 * survives the tab being closed. Losing it on reload is fine, because the refresh cookie
 * can mint a new one.
 *
 * It retries once on a 401 by refreshing first, so a request that crosses the fifteen
 * minute access token boundary succeeds instead of bouncing the user to the login page.
 *
 * What it does not do is decide permissions. It cannot: it only ever sees what the API
 * chose to return.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Set on the retry so a failed refresh cannot loop. */
  skipRefresh?: boolean;
};

async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    // The refresh token travels as an httpOnly cookie, which is only attached when
    // credentials are included.
    credentials: "include",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !options.skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) response = await rawRequest(path, { ...options, skipRefresh: true });
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "unknown",
      payload?.error?.message ?? response.statusText,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type SessionUser = {
  id: number;
  email: string;
  fullName: string;
  jobTitle: string;
  locale: "es" | "en";
};

type SessionResponse = { user: SessionUser; accessToken: string; expiresInSeconds: number };

export async function login(email: string, password: string): Promise<SessionUser> {
  const response = await request<SessionResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    skipRefresh: true,
  });
  accessToken = response.accessToken;
  return response.user;
}

/** Exchanges the refresh cookie for a new access token. Returns null when there is no session. */
export async function refreshSession(): Promise<SessionUser | null> {
  const response = await rawRequest("/auth/refresh", { method: "POST" });
  if (!response.ok) {
    accessToken = null;
    return null;
  }
  const payload = (await response.json()) as SessionResponse;
  accessToken = payload.accessToken;
  return payload.user;
}

export async function logout(): Promise<void> {
  await rawRequest("/auth/logout", { method: "POST" });
  accessToken = null;
}
