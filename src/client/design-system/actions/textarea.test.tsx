import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Textarea } from "./textarea.tsx";

// A stateful host so the controlled textarea accepts typing like it does in
// real callers.
function Harness(props: Omit<Parameters<typeof Textarea>[0], "value" | "onChange">) {
  const [value, setValue] = useState("");
  return <Textarea {...props} value={value} onChange={setValue} />;
}

describe("<Textarea>", () => {
  it("associates the label and help line with the control", () => {
    render(<Harness label="Notes" description="Anything worth keeping." required />);
    const control = screen.getByRole("textbox", { name: /notes/i });
    expect(control.getAttribute("aria-required")).toBe("true");
    expect(control.getAttribute("aria-describedby")).toBe(
      screen.getByText("Anything worth keeping.").id,
    );
  });

  it("reports typed input through onChange", async () => {
    const onChange = mock((_value: string) => {});
    render(<Textarea value="" onChange={onChange} label="Notes" />);
    await userEvent.type(screen.getByRole("textbox"), "a");
    expect(onChange.mock.calls).toEqual([["a"]]);
  });

  it("names the bare control via aria-label when there is no visible label", () => {
    render(<Harness bare aria-label="Message" maxRows={6} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDefined();
  });

  it("prefers the visible label over a stray aria-label", () => {
    render(<Harness label="Notes" aria-label="Ignored" />);
    expect(screen.getByRole("textbox", { name: /notes/i }).getAttribute("aria-label")).toBeNull();
  });
});
