/** Severity of a config-health check: wired correctly, working-but-reduced, or broken. */
export type ConfigCheckLevel = "ok" | "degraded" | "error";

/** The configuration concern a check reports on. */
export type ConfigArea = "config" | "providers" | "mcp" | "models";

/** A single configuration-health finding, as returned by `GET /api/config/health`. */
export interface ConfigCheck {
  area: ConfigArea;
  level: ConfigCheckLevel;
  title: string;
  detail: string;
}

/** The workspace's configuration-health report. */
export interface ConfigHealth {
  checks: ConfigCheck[];
}
