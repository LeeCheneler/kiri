import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppWindow } from "./app-window.tsx";

const props = {
  src: "/screenshots/session.png",
  alt: "A kiri session",
  title: "session — designing the forecast model",
  width: 1440,
  height: 900,
};

describe("<AppWindow>", () => {
  it("shows the framed screenshot without a lightbox until clicked", () => {
    render(<AppWindow {...props} />);
    expect(screen.getByRole("img", { name: props.alt })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the screenshot full size in a dialog on click", async () => {
    const user = userEvent.setup();
    render(<AppWindow {...props} />);
    await user.click(screen.getByRole("button", { name: `View full size: ${props.title}` }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-label")).toBe(props.title);
  });

  it("closes on the native Escape cancel event", async () => {
    const user = userEvent.setup();
    render(<AppWindow {...props} />);
    await user.click(screen.getByRole("button", { name: `View full size: ${props.title}` }));
    // happy-dom doesn't model Escape firing `cancel`, so dispatch it directly.
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a click anywhere in the lightbox", async () => {
    const user = userEvent.setup();
    render(<AppWindow {...props} />);
    await user.click(screen.getByRole("button", { name: `View full size: ${props.title}` }));
    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
