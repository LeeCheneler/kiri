import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { McpTools } from "./mcp-tools.tsx";

const renderTools = (ui: ReactNode = <McpTools />) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

// A connected server exposing two tools — one with a description, one without —
// plus a server needing sign-in and a failed one, to exercise every branch.
const toolsPayload = {
  servers: [
    {
      name: "linear",
      type: "http",
      state: "connected",
      tools: [
        {
          name: "create_issue",
          namespacedName: "linear__create_issue",
          description: "Create an issue",
          permission: "ask",
        },
        { name: "search", namespacedName: "linear__search", permission: "off" },
      ],
    },
    { name: "files", type: "stdio", state: "connected", tools: [] },
    { name: "github", type: "http", state: "needs-sign-in", tools: [] },
    { name: "down", type: "stdio", state: "failed", error: "Unable to connect", tools: [] },
  ],
  builtin: [],
};

describe("<McpTools>", () => {
  it("shows a loading state while the listing is in flight", () => {
    server.use(http.get("*/api/mcp/tools", () => new Promise<Response>(() => {})));
    renderTools();
    expect(screen.getByText(/loading mcp servers/i)).toBeDefined();
  });

  it("shows an error notice when the listing fails to load", async () => {
    server.use(http.get("*/api/mcp/tools", () => new HttpResponse(null, { status: 500 })));
    renderTools();
    expect(await screen.findByText(/couldn't load mcp servers/i)).toBeDefined();
  });

  it("shows an empty state when no servers are configured", async () => {
    server.use(http.get("*/api/mcp/tools", () => HttpResponse.json({ servers: [], builtin: [] })));
    renderTools();
    expect(await screen.findByText(/no mcp servers are configured/i)).toBeDefined();
  });

  it("renders each server with its tools, sign-in prompt, and failure reason", async () => {
    server.use(http.get("*/api/mcp/tools", () => HttpResponse.json(toolsPayload)));
    renderTools();

    // Connected servers start collapsed — expand them to reach their contents.
    await userEvent.click(await screen.findByRole("button", { name: /linear/i }));
    await userEvent.click(screen.getByRole("button", { name: /files/i }));

    // A connected server's tools each carry a permission control reflecting state.
    const createGroup = screen.getByRole("radiogroup", {
      name: "Permission for create_issue",
    });
    expect(
      (within(createGroup).getByRole("radio", { name: "Ask" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByText("Create an issue")).toBeDefined();
    const searchGroup = screen.getByRole("radiogroup", { name: "Permission for search" });
    expect(
      (within(searchGroup).getByRole("radio", { name: "Off" }) as HTMLInputElement).checked,
    ).toBe(true);
    // A connected server with no tools says so; a failed server shows its reason.
    expect(screen.getByText(/this server exposes no tools/i)).toBeDefined();
    expect(screen.getByText("Unable to connect")).toBeDefined();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDefined();
  });

  it("opens the sign-in flow when Connect is clicked", async () => {
    server.use(http.get("*/api/mcp/tools", () => HttpResponse.json(toolsPayload)));
    const opened: string[] = [];
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
    try {
      renderTools();
      await userEvent.click(await screen.findByRole("button", { name: "Connect" }));
      expect(opened[0]).toContain("/api/mcp/github/auth/start");
    } finally {
      window.open = originalOpen;
    }
  });

  it("persists a permission change and reflects the server's new value", async () => {
    let permission = "ask";
    const recorded: { tool?: string; permission?: string }[] = [];
    server.use(
      http.get("*/api/mcp/tools", () =>
        HttpResponse.json({
          servers: [
            {
              name: "linear",
              type: "http",
              state: "connected",
              tools: [{ name: "search", namespacedName: "linear__search", permission }],
            },
          ],
          builtin: [],
        }),
      ),
      http.post("*/api/mcp/tool-permissions", async ({ request }) => {
        const body = (await request.json()) as { tool?: string; permission?: string };
        recorded.push(body);
        permission = body.permission ?? permission;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderTools();

    // The server starts collapsed — expand it to reach the tool's control.
    await userEvent.click(await screen.findByRole("button", { name: /linear/i }));
    const group = screen.getByRole("radiogroup", { name: "Permission for search" });
    expect((within(group).getByRole("radio", { name: "Ask" }) as HTMLInputElement).checked).toBe(
      true,
    );
    await userEvent.click(within(group).getByRole("radio", { name: "Off" }));

    expect(recorded).toEqual([{ tool: "linear__search", permission: "off" }]);
    // The post-write refetch settles the control on the server's recorded value.
    await waitFor(() => {
      const settled = screen.getByRole("radiogroup", { name: "Permission for search" });
      expect(
        (within(settled).getByRole("radio", { name: "Off" }) as HTMLInputElement).checked,
      ).toBe(true);
    });
  });

  it("offers Auto on the shell tool only, and persists selecting it", async () => {
    let permission = "ask";
    const recorded: { tool?: string; permission?: string }[] = [];
    server.use(
      http.get("*/api/mcp/tools", () =>
        HttpResponse.json({
          servers: [
            {
              name: "linear",
              type: "http",
              state: "connected",
              tools: [{ name: "search", namespacedName: "linear__search", permission: "ask" }],
            },
          ],
          builtin: [
            { name: "run_command", description: "Run a shell command.", permission },
            { name: "run_workflow", description: "Run a workflow.", permission: "ask" },
          ],
        }),
      ),
      http.post("*/api/mcp/tool-permissions", async ({ request }) => {
        const body = (await request.json()) as { tool?: string; permission?: string };
        recorded.push(body);
        permission = body.permission ?? permission;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderTools();

    await userEvent.click(await screen.findByRole("button", { name: /built-in tools/i }));
    const shellGroup = await screen.findByRole("radiogroup", {
      name: "Permission for run_command",
    });
    await userEvent.click(within(shellGroup).getByRole("radio", { name: "Auto" }));

    expect(recorded).toEqual([{ tool: "run_command", permission: "auto" }]);
    await waitFor(() => {
      const settled = screen.getByRole("radiogroup", { name: "Permission for run_command" });
      expect(
        (within(settled).getByRole("radio", { name: "Auto" }) as HTMLInputElement).checked,
      ).toBe(true);
    });

    // No judgement exists for other built-ins or MCP tools, so Auto is absent
    // there rather than offered as a synonym for Ask.
    const workflowGroup = screen.getByRole("radiogroup", { name: "Permission for run_workflow" });
    expect(within(workflowGroup).queryByRole("radio", { name: "Auto" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /linear/i }));
    const mcpGroup = screen.getByRole("radiogroup", { name: "Permission for search" });
    expect(within(mcpGroup).queryByRole("radio", { name: "Auto" })).toBeNull();
  });

  it("renders the built-in kiri tools and persists their permission change", async () => {
    let permission = "ask";
    const recorded: { tool?: string; permission?: string }[] = [];
    server.use(
      http.get("*/api/mcp/tools", () =>
        HttpResponse.json({
          servers: [],
          builtin: [
            {
              name: "run_workflow",
              description: "Run one of the workspace's workflows and wait for it to finish.",
              permission,
            },
          ],
        }),
      ),
      http.post("*/api/mcp/tool-permissions", async ({ request }) => {
        const body = (await request.json()) as { tool?: string; permission?: string };
        recorded.push(body);
        permission = body.permission ?? permission;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderTools();

    // The built-in card is collapsed by default, so expand it first. The
    // permission is keyed by the tool's plain name, not a namespaced one.
    await userEvent.click(await screen.findByRole("button", { name: /built-in tools/i }));
    const group = await screen.findByRole("radiogroup", { name: "Permission for run_workflow" });
    expect((within(group).getByRole("radio", { name: "Ask" }) as HTMLInputElement).checked).toBe(
      true,
    );
    await userEvent.click(within(group).getByRole("radio", { name: "Always allow" }));

    expect(recorded).toEqual([{ tool: "run_workflow", permission: "allow" }]);
    await waitFor(() => {
      const settled = screen.getByRole("radiogroup", { name: "Permission for run_workflow" });
      expect(
        (within(settled).getByRole("radio", { name: "Always allow" }) as HTMLInputElement).checked,
      ).toBe(true);
    });
  });
});
