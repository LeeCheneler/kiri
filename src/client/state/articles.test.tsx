import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { useArticle } from "./articles.ts";
import { createQueryClient } from "./query-client.ts";

const Probe = ({ runId, name }: { runId: string; name: string }) => {
  const { data } = useArticle(runId, name);
  return <div>{data?.title}</div>;
};

const renderProbe = (runId: string, name: string) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Probe runId={runId} name={name} />
    </QueryClientProvider>,
  );

describe("articles state", () => {
  it("fetches and exposes a single article by run id and name", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "Morning Briefing",
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
