import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { InputsSpec } from "./inputs-spec.tsx";

describe("<InputsSpec>", () => {
  it("shows an empty state when there are no inputs", () => {
    render(<InputsSpec inputs={[]} />);
    expect(screen.getByText(/declares no inputs/i)).toBeDefined();
  });

  it("renders a row per input with type, requiredness, default, and description", () => {
    render(
      <InputsSpec
        inputs={[
          { name: "pr_number", required: true, description: "PR to review" },
          { name: "depth", options: ["shallow", "deep"], default: "shallow" },
        ]}
      />,
    );
    expect(screen.getByText("pr_number")).toBeDefined();
    expect(screen.getByText("required")).toBeDefined();
    expect(screen.getByText("PR to review")).toBeDefined();
    expect(screen.getByText("depth")).toBeDefined();
    expect(screen.getByText("enum")).toBeDefined();
    expect(screen.getByText("optional")).toBeDefined();
    // The default value renders in its own emphasised span.
    expect(screen.getByText("shallow")).toBeDefined();
  });
});
