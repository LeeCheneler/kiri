import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { LoadingState } from "./loading-state.tsx";

afterEach(() => cleanup());

describe("<LoadingState>", () => {
  it("renders its children as paragraph text", () => {
    render(<LoadingState>Loading run…</LoadingState>);
    expect(screen.getByText("Loading run…")).toBeDefined();
  });

  it("exposes role='status' so assistive tech announces the loading transition", () => {
    render(<LoadingState>Loading run…</LoadingState>);
    expect(screen.getByRole("status").textContent).toBe("Loading run…");
  });
});
