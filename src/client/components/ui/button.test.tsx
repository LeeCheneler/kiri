import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button.tsx";

afterEach(() => cleanup());

describe("<Button>", () => {
  it("renders the children as the label by default", () => {
    render(<Button>copy</Button>);
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeDefined();
  });

  it("defaults to the primary variant exposed via data-variant", () => {
    render(<Button>copy</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("primary");
  });

  it("exposes the danger variant via data-variant for destructive actions", () => {
    render(<Button variant="danger">delete</Button>);
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("danger");
  });

  it("fires onClick when the user clicks", async () => {
    const user = userEvent.setup();
    const onClick = mock(() => {});
    render(<Button onClick={onClick}>copy</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick.mock.calls.length).toBe(1);
  });

  it("renders the pending label and disables itself while pending", () => {
    render(
      <Button pending pendingLabel="cancelling…">
        cancel run
      </Button>,
    );
    const button = screen.getByRole("button", { name: /cancelling…/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("respects an explicit disabled prop independently of pending", () => {
    render(<Button disabled>copy</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("forwards type and title to the underlying button element", () => {
    render(
      <Button type="submit" title="run the workflow">
        run →
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("title")).toBe("run the workflow");
  });
});
