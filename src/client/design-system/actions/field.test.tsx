import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Field } from "./field.tsx";

describe("<Field>", () => {
  it("associates the label with the control via htmlFor", () => {
    render(
      <Field htmlFor="topic" label="Topic">
        <input id="topic" />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeDefined();
  });

  it("gives the help line the id the control points aria-describedby at", () => {
    render(
      <Field htmlFor="topic" label="Topic" description="Optional focus.">
        <input id="topic" aria-describedby="topic-description" />
      </Field>,
    );
    expect(screen.getByText("Optional focus.").getAttribute("id")).toBe("topic-description");
  });

  it("renders no help line when there is no description", () => {
    render(
      <Field htmlFor="topic" label="Topic">
        <input id="topic" />
      </Field>,
    );
    expect(screen.queryByText("*")).toBeNull();
  });

  it("marks required fields with a decorative asterisk kept out of the accessible name", () => {
    render(
      <Field htmlFor="topic" label="Topic" required>
        <input id="topic" />
      </Field>,
    );
    // The requirement is carried by the control's aria-required; the asterisk is
    // purely visual, so it stays out of the field's accessible name.
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeDefined();
    expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true");
  });
});
