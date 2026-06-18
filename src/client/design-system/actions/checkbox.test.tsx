import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./checkbox.tsx";

describe("<Checkbox>", () => {
  it("renders a labelled checkbox", () => {
    render(<Checkbox label="recipes" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "recipes" })).toBeDefined();
  });

  it("reflects the controlled checked state", () => {
    render(<Checkbox label="recipes" checked onChange={() => {}} />);
    expect((screen.getByRole("checkbox", { name: "recipes" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("calls onChange with the next boolean when toggled", async () => {
    const user = userEvent.setup();
    const onChange = mock((_checked: boolean) => {});
    render(<Checkbox label="recipes" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox", { name: "recipes" }));
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it("toggles when the label text is clicked", async () => {
    const user = userEvent.setup();
    const onChange = mock((_checked: boolean) => {});
    render(<Checkbox label="recipes" checked onChange={onChange} />);
    await user.click(screen.getByText("recipes"));
    expect(onChange.mock.calls).toEqual([[false]]);
  });

  it("does not fire onChange while disabled", async () => {
    const user = userEvent.setup();
    const onChange = mock((_checked: boolean) => {});
    render(<Checkbox label="recipes" checked={false} onChange={onChange} disabled />);
    const box = screen.getByRole("checkbox", { name: "recipes" }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    await user.click(box);
    expect(onChange.mock.calls).toEqual([]);
  });
});
