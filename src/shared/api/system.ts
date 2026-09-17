/**
 * The version string this kiri process advertises. Injected at release-time
 * via `bun build --define KIRI_VERSION=…`; falls back to `"dev"` for local
 * `bun start` and tests.
 */
export interface VersionInfo {
  version: string;
}

/**
 * Minimal projection of GitHub's release object. Only the fields the SPA
 * needs to render an "upgrade available" nudge — the tag for comparison
 * and the html_url for the "view release" link.
 */
export interface LatestRelease {
  tagName: string;
  htmlUrl: string;
}

/** Health response body. */
export type HealthResult = { status: "ok" };
