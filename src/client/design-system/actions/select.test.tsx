import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./select.tsx";

describe("<Select>", () => {
  it("renders its options", () => {
    render(
      <Select value="daily" onChange={() => {}}>
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
      </Select>,
    );
    expect(screen.getByRole("combobox")).toBeDefined();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["daily", "weekly"]);
  });

  it("reflects the controlled value", () => {
    render(
      <Select value="weekly" onChange={() => {}}>
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
      </Select>,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("weekly");
  });

  it("calls onChange with the selected value", async () => {
    const user = userEvent.setup();
    const onChange = mock((_value: string) => {});
    render(
      <Select value="daily" onChange={onChange}>
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole("combobox"), "weekly");
    expect(onChange.mock.calls).toEqual([["weekly"]]);
  });

  it("can be disabled", () => {
    render(
      <Select value="daily" onChange={() => {}} disabled>
        <option value="daily">daily</option>
      </Select>,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  });

  it("renders a label associated with the control", () => {
    render(
      <Select label="Cadence" value="daily" onChange={() => {}}>
        <option value="daily">daily</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Cadence" })).toBeDefined();
  });

  it("wires the description as the field's accessible description", () => {
    render(
      <Select label="Cadence" description="How often it runs." value="daily" onChange={() => {}}>
        <option value="daily">daily</option>
      </Select>,
    );
    const select = screen.getByRole("combobox", { name: "Cadence" });
    const describedBy = select.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe("How often it runs.");
  });

  it("marks required fields via aria-required", () => {
    render(
      <Select label="Cadence" required value="daily" onChange={() => {}}>
        <option value="daily">daily</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Cadence" }).getAttribute("aria-required")).toBe(
      "true",
    );
  });
});
