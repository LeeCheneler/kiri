import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionProviderNotices } from "./session-provider-notices.tsx";

describe("<SessionProviderNotices>", () => {
  it("explains which provider failed and why", async () => {
    server.use(
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [],
          failures: [{ provider: "openai", reason: "401 Unauthorized" }],
        }),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProviderNotices />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("openai models unavailable")).toBeDefined();
    expect(screen.getByText("401 Unauthorized")).toBeDefined();
  });
});
