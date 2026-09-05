import { afterEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { NotificationsToggle } from "./notifications-toggle.tsx";
import {
  type Notifier,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "./notifier.ts";

// Fake notifier whose permission flips to `result` once prompted, except a
// dismissed prompt (`default`), which leaves the state untouched.
const makeNotifier = (opts: {
  initial?: NotificationPermission;
  result?: NotificationPermission;
}): Notifier => {
  let current = opts.initial ?? "default";
  return {
    permission: () => current,
    requestPermission: async () => {
      const result = opts.result ?? "granted";
      if (result !== "default") current = result;
      return result;
    },
    show: () => {},
  };
};

const bell = () =>
  screen.getByRole("button", { name: "Desktop notifications" }) as HTMLButtonElement;
const pressed = () => bell().getAttribute("aria-pressed");

afterEach(() => {
  setDesktopNotificationsEnabled(false);
});

describe("<NotificationsToggle>", () => {
  it("persists the preference once the browser grants permission", async () => {
    render(<NotificationsToggle notifier={makeNotifier({ result: "granted" })} />);
    expect(pressed()).toBe("false");
    expect(bell().title).toBe("Desktop notifications off");
    fireEvent.click(bell());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(true);
    expect(pressed()).toBe("true");
    expect(bell().title).toBe("Desktop notifications on");
  });

  it("stays off and disables the button when the prompt is denied", async () => {
    render(<NotificationsToggle notifier={makeNotifier({ result: "denied" })} />);
    fireEvent.click(bell());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(pressed()).toBe("false");
    expect(bell().disabled).toBe(true);
    expect(bell().title).toMatch(/blocked in the browser/i);
  });

  it("stays off but re-promptable when the prompt is dismissed", async () => {
    render(<NotificationsToggle notifier={makeNotifier({ result: "default" })} />);
    fireEvent.click(bell());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(pressed()).toBe("false");
    expect(bell().disabled).toBe(false);
    expect(bell().title).not.toMatch(/blocked in the browser/i);
  });

  it("clears the preference when switched off", async () => {
    setDesktopNotificationsEnabled(true);
    render(<NotificationsToggle notifier={makeNotifier({ initial: "granted" })} />);
    expect(pressed()).toBe("true");
    fireEvent.click(bell());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(pressed()).toBe("false");
  });

  it("renders disabled with a hint when the browser has notifications blocked", () => {
    render(<NotificationsToggle notifier={makeNotifier({ initial: "denied" })} />);
    expect(bell().disabled).toBe(true);
    expect(bell().title).toMatch(/blocked in the browser/i);
  });
});
