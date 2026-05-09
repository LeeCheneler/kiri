import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../tests/setup/msw.ts";
import { App } from "./app.tsx";

afterEach(() => cleanup());

describe("<App>", () => {
  it("mounts, loads the registry + feed, and refetches on refresh", async () => {
    let workflowsCalls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        workflowsCalls += 1;
        return HttpResponse.json([]);
      }),
    );

    render(<App />);

    expect(screen.getByRole("heading", { name: /kiri/i })).toBeDefined();
    await waitFor(() => expect(workflowsCalls).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(workflowsCalls).toBe(2));
  });

  it("surfaces fetch errors via the api client's error parsing", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json({ error: "registry unavailable" }, { status: 500 }),
      ),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/registry unavailable/i)).toBeDefined();
    });
  });
});
