import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { ToastContainer } from "./toast-container.tsx";

afterEach(() => cleanup());

const renderToasts = ({
  path = "/",
  autoDismissMs = 60,
}: { path?: string; autoDismissMs?: number } = {}) => {
  const { hook } = memoryLocation({ path });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <ToastContainer autoDismissMs={autoDismissMs} />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("<ToastContainer>", () => {
  it("pops a toast when a run finishes off-page", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "deploy",
      });
    });
    expect(screen.getByText("deploy")).toBeDefined();
    expect(screen.getByText("ok")).toBeDefined();
  });

  it("renders a failed toast with the failed status word", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "failed",
        workflowName: "deploy",
      });
    });
    expect(screen.getByText("failed")).toBeDefined();
  });

  it("renders a cancelled toast with the cancelled status word", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "cancelled",
        workflowName: "deploy",
      });
    });
    expect(screen.getByText("cancelled")).toBeDefined();
  });

  it("suppresses the toast when the user is on /runs/:id for the same run", () => {
    const { sources } = renderToasts({ path: "/runs/abc" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "deploy",
      });
    });
    expect(screen.queryByText("deploy")).toBeNull();
  });

  it("still toasts when the user is on a different run page", () => {
    const { sources } = renderToasts({ path: "/runs/other" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "deploy",
      });
    });
    expect(screen.getByText("deploy")).toBeDefined();
  });

  it("links the toast body to /runs/:id", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "deploy",
      });
    });
    const link = screen.getByRole("link", { name: /deploy/i });
    expect(link.getAttribute("href")).toBe("/runs/abc");
  });

  it("auto-dismisses after the configured timeout", async () => {
    const { sources } = renderToasts({ path: "/", autoDismissMs: 30 });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "deploy",
      });
    });
    expect(screen.getByText("deploy")).toBeDefined();
    await act(async () => {
      await wait(60);
    });
    expect(screen.queryByText("deploy")).toBeNull();
  });

  it("dismisses immediately when X is clicked", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "ok",
        workflowName: "deploy",
      });
    });
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    act(() => {
      dismiss.click();
    });
    expect(screen.queryByText("deploy")).toBeNull();
  });

  it("stacks multiple concurrent toasts in arrival order, newest at the bottom", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "first",
        status: "ok",
        workflowName: "alpha",
      });
      sources[0]?.emit({
        type: "run.finished",
        id: "second",
        status: "failed",
        workflowName: "beta",
      });
    });
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("/runs/first");
    expect(links[1]?.getAttribute("href")).toBe("/runs/second");
  });

  it("ignores run.finished events with a non-terminal status", () => {
    const { sources } = renderToasts({ path: "/" });
    act(() => {
      sources[0]?.emit({
        type: "run.finished",
        id: "abc",
        status: "running",
        workflowName: "deploy",
      });
    });
    expect(screen.queryByText("deploy")).toBeNull();
  });

  it("exposes the stack region as a polite live region named 'notifications'", () => {
    renderToasts({ path: "/" });
    const region = screen.getByRole("status", { name: /notifications/i });
    expect(region.getAttribute("aria-live")).toBe("polite");
  });
});
