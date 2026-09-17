import type { ConfigHealth } from "../../shared/api/config.ts";
import { apiFetch, json } from "./http.ts";

/** Fetch the workspace's configuration-health report. Throws on non-2xx. */
export const fetchConfigHealth = async (): Promise<ConfigHealth> =>
  json<ConfigHealth>(await apiFetch("/api/config/health"));
