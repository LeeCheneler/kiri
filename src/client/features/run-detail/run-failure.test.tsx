import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunFailure } from "./run-failure.tsx";

describe("<RunFailure>", () => {
  it("announces the run-level failure with its message and no stack toggle", () => {
    render(<RunFailure error={{ message: "step exited with code 1" }} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/run failed/i);
    expect(screen.getByText("step exited with code 1")).toBeDefined();
    expect(screen.queryByRole("button", { name: /stack/i })).toBeNull();
  });

  it("reveals the stack behind a disclosure when present", async () => {
    const user = userEvent.setup();
    render(<RunFailure error={{ message: "boom", stack: "Error: boom\n  at run" }} />);

    // Collapsed by default — the stack body isn't in the document yet.
    expect(screen.queryByText(/at run/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /stack/i }));
    expect(screen.getByText(/at run/)).toBeDefined();
  });
});
