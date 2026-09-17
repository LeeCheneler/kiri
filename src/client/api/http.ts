import type { ApiErrorBody } from "../../shared/api/errors.ts";
/**
 * Error thrown for non-2xx responses from kiri's API. Carries the HTTP
 * status so call sites can branch on it (e.g. show a "not found" view on
 * 404) without parsing the message.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Reject unsuccessful API responses using their public error message. */
export const assertOk = async (res: Response): Promise<void> => {
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>;
  throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
};

/** Read a successful JSON response using its declared public contract. */
export const json = async <T>(res: Response): Promise<T> => {
  await assertOk(res);
  return (await res.json()) as T;
};

// When the bundle runs from the hosted shell at https://local.kiri.build,
// relative URLs would resolve against that origin and never reach kiri.
// Target the loopback kiri origin explicitly in that case; stay relative
// for localhost so dev (vite proxy) and direct kiri access stay same-origin.
const KIRI_ORIGIN = "http://127.0.0.1:4242";

const apiOrigin =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? ""
    : KIRI_ORIGIN;

/** Resolve an API path against the local Kiri server. */
export const apiUrl = (path: string) => `${apiOrigin}${path}`;

// Identifies this client to the server's CSRF gate. Presence is what matters;
// the value is informational. State-changing endpoints reject requests
// missing this header — kiri's belt-and-braces defence atop the CORS allow-list.
/** Header required for state-changing requests. */
export const CLIENT_HEADER_NAME = "X-Kiri-Client";

/** Identity advertised by the browser client. */
export const CLIENT_HEADER_VALUE = "kiri-ui";

/** Fetch from Kiri with the client header required by its CSRF gate. */
export const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set(CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE);
  return fetch(apiUrl(path), { ...init, headers });
};
