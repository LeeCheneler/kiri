import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToggleChip } from "./toggle-chip.tsx";

describe("<ToggleChip>", () => {
  it("renders a labelled checkbox", () => {
    render(<ToggleChip label="drinks" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "drinks" })).toBeDefined();
  });

  it("reflects the controlled checked state", () => {
    render(<ToggleChip label="drinks" checked onChange={() => {}} />);
    expect((screen.getByRole("checkbox", { name: "drinks" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("calls onChange with the next boolean when toggled", async () => {
    const user = userEvent.setup();
    const onChange = mock((_checked: boolean) => {});
    render(<ToggleChip label="drinks" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "drinks" }));
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it("toggles when the label text is clicked", async () => {
    const user = userEvent.setup();
    const onChange = mock((_checked: boolean) => {});
    render(<ToggleChip label="drinks" checked onChange={onChange} />);
    await user.click(screen.getByText("drinks"));
    expect(onChange.mock.calls).toEqual([[false]]);
  });

  it("does not fire onChange while disabled", async () => {
    const user = userEvent.setup();
    const onChange = mock((_checked: boolean) => {});
    render(<ToggleChip label="drinks" checked={false} onChange={onChange} disabled />);
    const box = screen.getByRole("checkbox", { name: "drinks" }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    await user.click(box);
    expect(onChange.mock.calls).toEqual([]);
  });
});
