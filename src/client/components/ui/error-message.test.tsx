import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorMessage } from "./error-message.tsx";

afterEach(() => cleanup());

describe("<ErrorMessage>", () => {
  it("renders an alert paragraph carrying the supplied message", () => {
    render(<ErrorMessage message="trigger failed" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("trigger failed");
  });

  it("renders nothing when message is null", () => {
    const { container } = render(<ErrorMessage message={null} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
