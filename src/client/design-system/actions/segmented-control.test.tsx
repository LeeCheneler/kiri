import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl, type SegmentedOption } from "./segmented-control.tsx";

const options: SegmentedOption<"allow" | "ask" | "off">[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "off", label: "Off" },
];

describe("<SegmentedControl>", () => {
  it("renders a labelled radio per option", () => {
    render(
      <SegmentedControl
        aria-label="Permission"
        options={options}
        value="ask"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Allow" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Ask" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Off" })).toBeDefined();
  });

  it("marks the option matching value as checked", () => {
    render(
      <SegmentedControl
        aria-label="Permission"
        options={options}
        value="off"
        onChange={() => {}}
      />,
    );
    expect((screen.getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Allow" }) as HTMLInputElement).checked).toBe(false);
  });

  it("calls onChange with the chosen value when a segment is clicked", async () => {
    const user = userEvent.setup();
    const onChange = mock((_value: string) => {});
    render(
      <SegmentedControl
        aria-label="Permission"
        options={options}
        value="ask"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(onChange.mock.calls).toEqual([["off"]]);
  });

  it("exposes a radiogroup named by the label lockup", () => {
    render(
      <SegmentedControl label="Permission" options={options} value="ask" onChange={() => {}} />,
    );
    expect(screen.getByRole("radiogroup", { name: "Permission" })).toBeDefined();
  });

  it("does not fire onChange while disabled", async () => {
    const user = userEvent.setup();
    const onChange = mock((_value: string) => {});
    render(
      <SegmentedControl
        aria-label="Permission"
        options={options}
        value="ask"
        onChange={onChange}
        disabled
      />,
    );
    const off = screen.getByRole("radio", { name: "Off" }) as HTMLInputElement;
    expect(off.disabled).toBe(true);
    await user.click(off);
    expect(onChange.mock.calls).toEqual([]);
  });
});
