import { useEffect, useState } from "react";
import { fetchLatestRelease, fetchVersion } from "../api.ts";

/**
 * Compare two semver-ish strings (e.g. "v0.1.0" or "0.2.3").
 * Returns -1 if `a < b`, 0 if equal or non-comparable, 1 if `a > b`.
 *
 * Tolerates a leading "v" and trims off any pre-release / build suffix
 * after the first "-" or "+" so "v0.2.0-rc1" sorts alongside "v0.2.0".
 * Returns 0 for any pair containing non-numeric parts so we never falsely
 * advertise an "update" when the running build is unversioned ("dev") or
 * the release tag deviates from the project's `vMAJOR.MINOR.PATCH` shape.
 */
export const compareVersions = (a: string, b: string): -1 | 0 | 1 => {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  if (!partsA || !partsB) return 0;
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const ai = partsA[i] ?? 0;
    const bi = partsB[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
};

const parseVersion = (raw: string): number[] | null => {
  const stripped = raw.replace(/^v/, "").split(/[-+]/)[0];
  if (!stripped) return null;
  const parts = stripped.split(".").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
};

const RELEASES_URL = "https://github.com/LeeCheneler/kiri/releases";

/**
 * Left-rail footer: shows the running kiri version with an inline update
 * nudge when a newer GitHub release is available. Both fetches fail
 * closed — if `/api/version` errors or GitHub can't be reached, the
 * footer renders nothing (or just the version on partial failure) so a
 * stale rate-limit blip doesn't push noise into the chrome.
 *
 * Update nudge is suppressed on "dev" builds and on tag shapes our
 * comparator can't parse, so local dev never spuriously claims it's
 * behind a release.
 */
export function VersionInfo() {
  const [current, setCurrent] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ tagName: string; htmlUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVersion()
      .then(({ version }) => {
        if (!cancelled) setCurrent(version);
      })
      .catch(() => {
        // Endpoint missing or unreachable — hide the footer entirely.
      });
    fetchLatestRelease()
      .then((release) => {
        if (!cancelled) setLatest(release);
      })
      .catch(() => {
        // GitHub rate-limited, offline, or the repo has no releases yet —
        // skip the upgrade nudge but still surface the running version.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (current === null) return null;

  const hasUpdate = latest !== null && compareVersions(current, latest.tagName) === -1;

  return (
    <div className="mt-10 border-t border-rule pt-6 text-xs text-ink-muted">
      <div className="font-mono">{current}</div>
      {hasUpdate && latest && (
        <a
          href={latest.htmlUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-flex items-center gap-1 text-accent no-underline transition-colors duration-150 hover:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
        >
          <span aria-hidden="true">→</span>
          <span>Update available: {latest.tagName}</span>
        </a>
      )}
      {!hasUpdate && (
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-ink-muted no-underline transition-colors duration-150 hover:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
        >
          Releases ↗
        </a>
      )}
    </div>
  );
}
