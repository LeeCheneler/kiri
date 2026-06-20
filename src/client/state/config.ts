import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ConfigHealth, fetchConfigHealth } from "../api.ts";
import { useLiveSync } from "../events/live.tsx";

const configHealthKey = ["config", "health"] as const;
// Models derive from the same kiri.yaml providers, so a config change restales
// the picker too. Mirrors the key in `state/sessions.ts`.
const modelsKey = ["models"] as const;

/**
 * Read the workspace's configuration-health report. Fetched on first use and
 * served from cache thereafter; kept current by `useConfigHealthLive`.
 */
export function useConfigHealth(): UseQueryResult<ConfigHealth> {
  return useQuery({ queryKey: configHealthKey, queryFn: fetchConfigHealth });
}

/**
 * Refetch the config-health report — and the models that share its source —
 * whenever the server reports a `kiri.yaml` change, and on event-stream
 * reconnect. Mount once near the root via `<LiveSync>`.
 */
export function useConfigHealthLive(): void {
  const queryClient = useQueryClient();
  useLiveSync({
    on: ["config.changed"],
    refetch: () => {
      void queryClient.invalidateQueries({ queryKey: configHealthKey });
      void queryClient.invalidateQueries({ queryKey: modelsKey });
    },
  });
}
