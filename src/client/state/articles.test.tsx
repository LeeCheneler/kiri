import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { useArticle } from "./articles.ts";
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

describe("articles state", () => {
  it("fetches and exposes a single article by run id and slug", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:slug", ({ params }) =>
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
});
