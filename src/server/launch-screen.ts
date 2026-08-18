import { homedir } from "node:os";
import type { ConfigCheckLevel, ConfigHealth } from "./config/health.ts";
import { box, c, fact } from "./log.ts";

/** Everything the boot sequence learned, summarised on the launch screen. */
export interface LaunchFacts {
  workspace: string;
  url: string;
  envLoaded: number;
  envFile: string;
  providers: string[];
  mcp: { connected: number; total: number };
  workflows: number;
  health: ConfigHealth;
}

/** Collapse the home directory to `~` for display. */
export function displayPath(path: string, home: string = homedir()): string {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const TAGLINE = "the AI workspace that writes things down";

/** The header box printed the moment kiri starts booting. */
export function renderHeader(version: string): string[] {
  return box([`${c.bold("kiri")} ${c.dim(version)}`, c.dim(TAGLINE)], { tint: c.magenta });
}

const LEVEL_MARK: Record<ConfigCheckLevel, string> = {
  ok: c.green("●"),
  degraded: c.yellow("●"),
  error: c.red("●"),
};

const LEVEL_TINT: Record<ConfigCheckLevel, (s: string) => string> = {
  ok: c.green,
  degraded: c.yellow,
  error: c.red,
};

/** Highest-severity level across the checks — the frame colour of the health box. */
function worstLevel(health: ConfigHealth): ConfigCheckLevel {
  if (health.checks.some((check) => check.level === "error")) return "error";
  if (health.checks.some((check) => check.level === "degraded")) return "degraded";
  return "ok";
}

/**
 * One row per degraded/error config check; empty when everything is ok. Passing
 * checks aren't listed — the ready box summarises those.
 */
export function renderHealth(health: ConfigHealth): string[] {
  const attention = health.checks.filter((check) => check.level !== "ok");
  if (attention.length === 0) return [];
  const rows = attention.map(
    (check) =>
      `${LEVEL_MARK[check.level]} ${check.level.padEnd(8)} ${check.title} ${c.dim("—")} ${c.dim(check.detail)}`,
  );
  return box(rows, { title: "config health", tint: LEVEL_TINT[worstLevel(health)] });
}

function healthSummary(health: ConfigHealth): string {
  const attention = health.checks.filter((check) => check.level !== "ok").length;
  if (attention === 0) return c.green("ok");
  return LEVEL_TINT[worstLevel(health)](`${attention} check(s) need attention`);
}

/** The closing box: what was loaded and where to open the app. */
export function renderReady(facts: LaunchFacts): string[] {
  const rows = [
    fact("workspace", facts.workspace),
    fact(
      "env",
      facts.envLoaded > 0
        ? `${facts.envLoaded} variable(s) from ${facts.envFile}`
        : c.dim("no .env loaded"),
    ),
    fact("providers", facts.providers.length > 0 ? facts.providers.join(", ") : c.dim("none")),
    fact(
      "mcp",
      facts.mcp.total > 0 ? `${facts.mcp.connected}/${facts.mcp.total} connected` : c.dim("none"),
    ),
    fact("workflows", `${facts.workflows} loaded`),
    fact("health", healthSummary(facts.health)),
    "",
    `${c.green("➜")}  ${c.bold(facts.url)}`,
  ];
  return box(rows, { title: "ready", tint: c.green });
}
