import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Notice } from "./notice.tsx";

describe("<Notice>", () => {
  it("renders the title and detail", () => {
    render(
      <Notice tone="warning" title="Web search disabled">
        TAVILY_API_KEY is not set
      </Notice>,
    );
    expect(screen.getByText("Web search disabled")).toBeDefined();
    expect(screen.getByText("TAVILY_API_KEY is not set")).toBeDefined();
  });

  it("exposes the tone as data-tone", () => {
    const { container, rerender } = render(<Notice tone="informational" title="x" />);
    expect(container.querySelector("[data-tone='informational']")).not.toBeNull();
    rerender(<Notice tone="negative" title="x" />);
    expect(container.querySelector("[data-tone='negative']")).not.toBeNull();
  });

  it("renders only the title when given no detail", () => {
    const { container } = render(<Notice tone="informational" title="Heads up" />);
    expect(screen.getByText("Heads up")).toBeDefined();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("is a silent visual callout by default", () => {
    render(<Notice tone="negative" title="Provider error" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces politely as a status region when asked", () => {
    render(<Notice tone="warning" announce="polite" title="Web search disabled" />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("announces assertively as an alert region when asked", () => {
    render(<Notice tone="negative" announce="assertive" title="Provider error" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });
});
