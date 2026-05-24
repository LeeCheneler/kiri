import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextButton } from "./text-button.tsx";

afterEach(() => cleanup());

describe("<TextButton>", () => {
  it("renders the children as the label by default", () => {
    render(<TextButton>cancel</TextButton>);
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDefined();
  });

  it("defaults to the muted tone exposed via data-tone", () => {
    render(<TextButton>cancel</TextButton>);
    expect(screen.getByRole("button").getAttribute("data-tone")).toBe("muted");
  });

  it("exposes the accent tone via data-tone for primary actions", () => {
    render(<TextButton tone="accent">run →</TextButton>);
    expect(screen.getByRole("button").getAttribute("data-tone")).toBe("accent");
  });

  it("fires onClick when the user clicks", async () => {
    const user = userEvent.setup();
    const onClick = mock(() => {});
    render(<TextButton onClick={onClick}>cancel</TextButton>);
    await user.click(screen.getByRole("button"));
    expect(onClick.mock.calls.length).toBe(1);
  });

  it("renders the pending label and disables itself while pending", () => {
    render(
      <TextButton tone="accent" pending pendingLabel="running…">
        run →
      </TextButton>,
    );
    const button = screen.getByRole("button", { name: /running…/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("respects an explicit disabled prop independently of pending", () => {
    render(<TextButton disabled>cancel</TextButton>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("forwards type and title to the underlying button element", () => {
    render(
      <TextButton type="submit" title="submit the form">
        run →
      </TextButton>,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("title")).toBe("submit the form");
  });
});
