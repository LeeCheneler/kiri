import { z } from "zod";
import type { LatestRelease, VersionInfo } from "../../shared/api/system.ts";

import { ApiError, apiFetch, json } from "./http.ts";

/** Fetch the running kiri version. Throws on non-2xx. */
export const fetchVersion = async (): Promise<VersionInfo> =>
  json<VersionInfo>(await apiFetch("/api/version"));

const LATEST_RELEASE_URL = "https://api.github.com/repos/LeeCheneler/kiri/releases/latest";

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
});

/**
 * Fetch the latest published release from kiri's GitHub repo. Calls the
 * GitHub REST API directly from the browser (CORS-friendly, no token
 * needed for public repos — 60 req/hr per IP is plenty for occasional
 * page loads). Throws on non-2xx so the caller can swallow and hide the
 * upgrade nudge silently.
 */
export const fetchLatestRelease = async (): Promise<LatestRelease> => {
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  }
  const parsed = releaseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError("malformed latest-release payload", 502);
  }
  return { tagName: parsed.data.tag_name, htmlUrl: parsed.data.html_url };
};
