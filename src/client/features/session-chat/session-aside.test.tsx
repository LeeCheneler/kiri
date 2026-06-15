import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionAside } from "./session-aside.tsx";

const sessionDetail = (overrides: Record<string, unknown> = {}) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...overrides,
  },
  messages: [],
});

const renderAside = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

describe("<SessionAside>", () => {
  it("renders the model, token totals, and start time", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ inputTokens: 7, outputTokens: 2, totalTokens: 9 })),
      ),
    );
    renderAside(<SessionAside id="s1" now={new Date("2026-05-09T12:00:30.000Z")} />);

    expect(await screen.findByText("anthropic:claude")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("9")).toBeDefined();
  });

  it("renders nothing until the session loads", () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    const { container } = renderAside(<SessionAside id="s1" />);
    expect(container.firstChild).toBeNull();
  });
});
