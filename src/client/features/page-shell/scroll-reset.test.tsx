import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ScrollReset } from "./scroll-reset.tsx";

describe("<ScrollReset>", () => {
  const originalScrollTo = window.scrollTo;
  let scrollTo: ReturnType<typeof mock>;

  beforeEach(() => {
    scrollTo = mock(() => {});
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
  });

  it("scrolls the window to the top on navigation", () => {
    const { hook, navigate } = memoryLocation({ path: "/runs/r1/articles/demo" });
    render(
      <Router hook={hook}>
        <ScrollReset />
      </Router>,
    );
    // The mount pass scrolls too (harmless — a fresh load is already at the
    // top); the behaviour under test is the route transition.
    scrollTo.mockClear();

    act(() => navigate("/"));

    // Instant, not smooth: the swap opts out of the document's animated
    // scroll-behavior so the new page lands at the top.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("does not scroll on re-renders that keep the route", () => {
    const { hook } = memoryLocation({ path: "/" });
    const { rerender } = render(
      <Router hook={hook}>
        <ScrollReset />
      </Router>,
    );
    scrollTo.mockClear();

    rerender(
      <Router hook={hook}>
        <ScrollReset />
      </Router>,
    );

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
