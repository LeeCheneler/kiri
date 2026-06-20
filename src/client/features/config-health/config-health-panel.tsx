import { Notice } from "../../design-system/feedback/notice.tsx";
import { useConfigHealth } from "../../state/config.ts";

/**
 * The home-page configuration-health banner. Surfaces the non-ok checks from
 * the config-health report — a degraded check as a warning, an error as a
 * negative Notice — so misconfiguration is visible the moment you land on the
 * app. Renders nothing while loading or when every check is ok, so a healthy
 * workspace sees no banner. Announced politely as it's advisory, not blocking.
 */
export function ConfigHealthPanel() {
  const issues = (useConfigHealth().data?.checks ?? []).filter((check) => check.level !== "ok");
  if (issues.length === 0) return null;
  return (
    <section aria-label="Configuration health" className="mb-8 space-y-3">
      {issues.map((check) => (
        <Notice
          key={`${check.area}:${check.title}`}
          tone={check.level === "error" ? "negative" : "warning"}
          announce="polite"
          title={check.title}
        >
          {check.detail}
        </Notice>
      ))}
    </section>
  );
}
