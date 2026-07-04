import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useArticle, useSessionArticle } from "./articles.ts";
import { createQueryClient } from "./query-client.ts";

const Probe = ({ runId, slug }: { runId: string; slug: string }) => {
  const { data } = useArticle(runId, slug);
  return <div>{data?.name}</div>;
};

const renderProbe = (runId: string, slug: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Probe runId={runId} slug={slug} />
    </QueryClientProvider>,
  );

const SessionProbe = ({ sessionId, slug }: { sessionId: string; slug: string }) => {
  const { data } = useSessionArticle(sessionId, slug);
  return <div>{data?.name}</div>;
};

// The session hook live-syncs, so it must render inside the events provider.
const renderSessionProbe = (sessionId: string, slug: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={captureEventSources().factory}>
        <SessionProbe sessionId={sessionId} slug={slug} />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );

describe("articles state", () => {
  it("fetches and exposes a single article by run id and slug", async () => {
    server.use(
      http.get("*/api/runs/:id/articles/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          slug: params.slug,
          name: "Morning Briefing",
          contentMd: "# Hello\n\nBody.\n",
          createdAt: new Date().toISOString(),
          workflowName: "briefing",
          heading: "Hello",
          gitSha: null,
          gitDirty: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        }),
      ),
    );

    renderProbe("run-1", "briefing");

    expect(await screen.findByText("Morning Briefing")).toBeDefined();
  });

  it("fetches and exposes a single session article by session id and slug", async () => {
    server.use(
      http.get("*/api/sessions/:id/articles/:slug", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          sessionId: params.id,
          slug: params.slug,
          name: "Meeting Notes",
          contentMd: "# Hello\n\nBody.\n",
          createdAt: new Date().toISOString(),
          heading: "Hello",
        }),
      ),
    );

    renderSessionProbe("session-1", "notes");

    expect(await screen.findByText("Meeting Notes")).toBeDefined();
  });
});
