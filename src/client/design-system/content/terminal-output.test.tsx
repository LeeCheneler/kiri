import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { TerminalOutput } from "./terminal-output.tsx";

describe("<TerminalOutput>", () => {
  it("interprets ANSI escapes instead of exposing them as text", () => {
    const { container } = render(<TerminalOutput>{"\u001b[32m2 passed\u001b[39m"}</TerminalOutput>);

    expect(screen.getByText("2 passed")).toBeDefined();
    expect(container.textContent).toBe("2 passed");
  });

  it("applies carriage returns like a terminal", () => {
    const { container } = render(<TerminalOutput>{"running\rcomplete"}</TerminalOutput>);

    expect(container.textContent).toBe("complete");
  });
});
