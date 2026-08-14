import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chip } from "./chip.tsx";

describe("<Chip>", () => {
  it("renders a labelled button", () => {
    render(<Chip onClick={() => {}}>Yes, proceed</Chip>);
    expect(screen.getByRole("button", { name: "Yes, proceed" })).toBeDefined();
  });

  it("fires onClick when tapped", async () => {
    const user = userEvent.setup();
    const onClick = mock(() => {});
    render(<Chip onClick={onClick}>Yes, proceed</Chip>);
    await user.click(screen.getByRole("button", { name: "Yes, proceed" }));
    expect(onClick.mock.calls).toHaveLength(1);
  });

  it("does not fire onClick while disabled", async () => {
    const user = userEvent.setup();
    const onClick = mock(() => {});
    render(
      <Chip onClick={onClick} disabled>
        Yes, proceed
      </Chip>,
    );
    const button = screen.getByRole("button", { name: "Yes, proceed" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(onClick.mock.calls).toHaveLength(0);
  });
});
