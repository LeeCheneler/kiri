import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover } from "./popover.tsx";

const renderPopover = () =>
  render(
    <Popover trigger="models" label="Models">
      <button type="button">inner control</button>
    </Popover>,
  );

describe("<Popover>", () => {
  it("opens the panel from the trigger and toggles it closed again", async () => {
    renderPopover();

    const trigger = screen.getByRole("button", { name: "models" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();

    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Models" })).toBeDefined();
    expect(screen.getByRole("button", { name: "inner control" })).toBeDefined();

    await userEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
  });

  it("closes on Escape, handing focus back to the trigger", async () => {
    renderPopover();

    const trigger = screen.getByRole("button", { name: "models" });
    await userEvent.click(trigger);
    screen.getByRole("button", { name: "inner control" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Escape from leaking to page-level handlers", async () => {
    let leaked = 0;
    const onWindowKeyDown = () => {
      leaked += 1;
    };
    window.addEventListener("keydown", onWindowKeyDown);
    try {
      renderPopover();
      await userEvent.click(screen.getByRole("button", { name: "models" }));
      screen.getByRole("button", { name: "inner control" }).focus();
      leaked = 0;

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
      expect(leaked).toBe(0);
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  });

  it("closes on a pointer-down outside, but not on one inside", async () => {
    renderPopover();

    await userEvent.click(screen.getByRole("button", { name: "models" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "inner control" }));
    expect(screen.getByRole("dialog", { name: "Models" })).toBeDefined();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Models" })).toBeNull();
  });
});
