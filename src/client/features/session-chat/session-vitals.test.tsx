import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionVitals } from "./session-vitals.tsx";

const sessionDetail = (messages: unknown[] = []) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    effort: "medium",
    title: null,
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
  },
  messages,
});

const assistantMessage = (contextTokens: number | null) => ({
  id: "m1",
  sessionId: "s1",
  index: 1,
  role: "assistant",
  parts: [{ type: "text", text: "hi" }],
  contextTokens,
  createdAt: "2026-05-09T12:00:00.000Z",
});

const modelListing = (contextWindow: number) =>
  http.get("*/api/models", () =>
    HttpResponse.json({
      models: [{ id: "anthropic:claude", provider: "anthropic", contextWindow, output: "text" }],
      failures: [],
    }),
  );

const renderVitals = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

describe("<SessionVitals>", () => {
  it("shows the context fill as a meter with its numbers when the window is known", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantMessage(1545)])),
      ),
      modelListing(200000),
    );
    renderVitals(<SessionVitals id="s1" />);

    expect(await screen.findByText("1,545 / 200,000 tokens")).toBeDefined();
    const meter = await screen.findByRole("meter", { name: "Context used" });
    expect(meter.getAttribute("aria-valuenow")).toBe("1545");
    expect(meter.getAttribute("aria-valuemax")).toBe("200000");
    expect(meter.getAttribute("data-tone")).toBe("accent");
  });

  it("escalates the meter to the warning tone as the fill nears the window", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantMessage(190_000)])),
      ),
      modelListing(200000),
    );
    renderVitals(<SessionVitals id="s1" />);

    const meter = await screen.findByRole("meter", { name: "Context used" });
    expect(meter.getAttribute("data-tone")).toBe("warning");
  });

  it("shows the numbers without a meter when the model's window is uncatalogued", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantMessage(1545)])),
      ),
    );
    renderVitals(<SessionVitals id="s1" />);

    expect(await screen.findByText("1,545 tokens")).toBeDefined();
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("shows only the start time until a turn has settled", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderVitals(<SessionVitals id="s1" now={new Date("2026-05-09T12:16:00.000Z")} />);

    expect(await screen.findByText("started 16 minutes ago")).toBeDefined();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it("renders nothing until the session loads", () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    const { container } = renderVitals(<SessionVitals id="s1" />);
    expect(container.firstChild).toBeNull();
  });
});
