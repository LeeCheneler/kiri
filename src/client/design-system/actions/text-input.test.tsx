import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextInput } from "./text-input.tsx";

describe("<TextInput>", () => {
  it("renders a labelled text box", () => {
    render(<TextInput label="Topic" value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeDefined();
  });

  it("reflects the controlled value", () => {
    render(<TextInput label="Topic" value="chips" onChange={() => {}} />);
    expect((screen.getByRole("textbox", { name: "Topic" }) as HTMLInputElement).value).toBe(
      "chips",
    );
  });

  it("calls onChange with the typed value", async () => {
    const user = userEvent.setup();
    const onChange = mock((_value: string) => {});
    render(<TextInput label="Topic" value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox", { name: "Topic" }), "a");
    expect(onChange.mock.calls).toEqual([["a"]]);
  });

  it("wires the description as the field's accessible description", () => {
    render(<TextInput label="Topic" description="Optional focus." value="" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Topic" });
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Optional focus.");
  });

  it("marks required fields via aria-required", () => {
    render(<TextInput label="Topic" required value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Topic" }).getAttribute("aria-required")).toBe(
      "true",
    );
  });

  it("renders the bare control when no label is given", () => {
    render(<TextInput value="" onChange={() => {}} placeholder="search" />);
    expect(screen.getByPlaceholderText("search")).toBeDefined();
    expect(screen.queryByText("*")).toBeNull();
  });

  it("can be disabled", () => {
    render(<TextInput label="Topic" value="" onChange={() => {}} disabled />);
    expect((screen.getByRole("textbox", { name: "Topic" }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});
