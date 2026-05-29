import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disclosure } from "./disclosure.tsx";

describe("<Disclosure>", () => {
  it("starts collapsed, hiding the panel", () => {
    render(
      <Disclosure summary="Configuration">
        <p>panel body</p>
      </Disclosure>,
    );
    expect(
      screen.getByRole("button", { name: "Configuration" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText("panel body")).toBeNull();
  });

  it("reveals the panel on click and links it to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Configuration">
        <p>panel body</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Configuration" });
    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByText("panel body").closest("div");
    expect(panel?.id).toBe(trigger.getAttribute("aria-controls") ?? "");
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Configuration">
        <p>panel body</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Configuration" });
    await user.click(trigger);
    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("panel body")).toBeNull();
  });

  it("starts expanded when defaultOpen is set", () => {
    render(
      <Disclosure summary="Configuration" defaultOpen>
        <p>panel body</p>
      </Disclosure>,
    );
    expect(
      screen.getByRole("button", { name: "Configuration" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("panel body")).toBeDefined();
  });
});
