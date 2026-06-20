import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useConfigHealth, useConfigHealthLive } from "./config.ts";
import { createQueryClient } from "./query-client.ts";
import { useModels } from "./sessions.ts";

const Probe = () => {
  useConfigHealthLive();
  const checks = useConfigHealth().data?.checks ?? [];
  const models = useModels().data?.models ?? [];
  return (
    <div>
      <p>checks:{checks.length}</p>
      <p>models:{models.length}</p>
    </div>
  );
};

const renderProbe = () => {
  const { factory, sources } = captureEventSources();
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Probe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...ui, sources };
};

describe("config state", () => {
  it("refetches the report and models when the config changes", async () => {
    server.use(
      http.get("*/api/config/health", () =>
        HttpResponse.json({
          checks: [{ area: "web-search", level: "degraded", title: "off", detail: "no key" }],
        }),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({ models: [{ id: "a:one", provider: "a" }], failures: [] }),
      ),
    );
    const { sources } = renderProbe();
    expect(await screen.findByText("checks:1")).toBeDefined();
    expect(await screen.findByText("models:1")).toBeDefined();

    // The user fixes kiri.yaml: the issue clears and a second model appears.
    server.use(
      http.get("*/api/config/health", () => HttpResponse.json({ checks: [] })),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "a:one", provider: "a" },
            { id: "a:two", provider: "a" },
          ],
          failures: [],
        }),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "config.changed" });
    });

    expect(await screen.findByText("checks:0")).toBeDefined();
    expect(await screen.findByText("models:2")).toBeDefined();
  });
});
