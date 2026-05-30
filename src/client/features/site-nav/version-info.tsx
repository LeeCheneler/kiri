import { useQuery } from "@tanstack/react-query";
import { fetchLatestRelease, fetchVersion } from "../../api.ts";
import { InlineLink } from "../../design-system/content/inline-link.tsx";

/**
 * Compare two semver-ish strings (e.g. "v0.1.0" or "0.2.3"). Returns -1
 * if `a < b`, 0 if equal or non-comparable, 1 if `a > b`.
 *
 * Tolerates a leading "v" and trims any pre-release / build suffix after
 * the first "-" or "+", so "v0.2.0-rc1" sorts alongside "v0.2.0". Returns
 * 0 for any pair containing non-numeric parts so an unversioned build
 * ("dev") or an off-shape release tag never falsely advertises an update.
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

/**
 * Left-rail footer: the running kiri version with an inline nudge when a
 * newer GitHub release exists. Both reads fail closed — if `/api/version`
 * errors the footer renders nothing; if the GitHub lookup errors the
 * version still shows without a nudge — so a rate-limit blip never pushes
 * noise into the chrome. The nudge is suppressed on "dev" builds and on
 * tag shapes the comparator can't parse. Both reads are cached, so the
 * footer doesn't re-fetch as the rail remounts across navigations.
 */
export function VersionInfo() {
  const { data: version } = useQuery({ queryKey: ["version"], queryFn: fetchVersion });
  const { data: latest } = useQuery({ queryKey: ["latest-release"], queryFn: fetchLatestRelease });

  const current = version?.version ?? null;
  if (current === null) return null;

  const hasUpdate = latest !== undefined && compareVersions(current, latest.tagName) === -1;

  return (
    <div className="mt-6 border-t border-rule pt-6 text-xs text-ink-muted">
      <div className="font-mono">{current}</div>
      {hasUpdate && latest && (
        <div className="mt-1">
          <InlineLink href={latest.htmlUrl}>Update available: {latest.tagName}</InlineLink>
        </div>
      )}
    </div>
  );
}
