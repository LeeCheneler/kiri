import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Actions } from "./actions.tsx";
import { Button } from "./button.tsx";

describe("<Actions>", () => {
  it("renders its button children in a row", () => {
    render(
      <Actions>
        <Button>run again</Button>
        <Button variant="danger">delete</Button>
      </Actions>,
    );
    expect(screen.getByRole("button", { name: /run again/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeDefined();
  });

  it("renders the shared error message below the row when supplied", () => {
    render(
      <Actions errorMessage="trigger failed">
        <Button>run →</Button>
      </Actions>,
    );
    expect(screen.getByRole("alert").textContent).toBe("trigger failed");
  });

  it("omits the alert when errorMessage is null", () => {
    render(
      <Actions errorMessage={null}>
        <Button>run →</Button>
      </Actions>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("omits the alert when errorMessage is unset", () => {
    render(
      <Actions>
        <Button>run →</Button>
      </Actions>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
