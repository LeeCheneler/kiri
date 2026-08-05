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

const onSegment = () => screen.getByRole("radio", { name: "On" }) as HTMLInputElement;
const offSegment = () => screen.getByRole("radio", { name: "Off" }) as HTMLInputElement;

afterEach(() => {
  setDesktopNotificationsEnabled(false);
});

describe("<NotificationsToggle>", () => {
  it("persists the preference once the browser grants permission", async () => {
    render(<NotificationsToggle notifier={makeNotifier({ result: "granted" })} />);
    fireEvent.click(onSegment());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(true);
    expect(onSegment().checked).toBe(true);
  });

  it("stays off and disables the control when the prompt is denied", async () => {
    render(<NotificationsToggle notifier={makeNotifier({ result: "denied" })} />);
    fireEvent.click(onSegment());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(offSegment().checked).toBe(true);
    expect(onSegment().disabled).toBe(true);
    expect(screen.getByText(/blocked in the browser/i)).toBeDefined();
  });

  it("stays off but re-promptable when the prompt is dismissed", async () => {
    render(<NotificationsToggle notifier={makeNotifier({ result: "default" })} />);
    fireEvent.click(onSegment());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(offSegment().checked).toBe(true);
    expect(onSegment().disabled).toBe(false);
    expect(screen.queryByText(/blocked in the browser/i)).toBeNull();
  });

  it("clears the preference when switched off", async () => {
    setDesktopNotificationsEnabled(true);
    render(<NotificationsToggle notifier={makeNotifier({ initial: "granted" })} />);
    expect(onSegment().checked).toBe(true);
    fireEvent.click(offSegment());
    await flushAsync();
    expect(desktopNotificationsEnabled()).toBe(false);
    expect(offSegment().checked).toBe(true);
  });

  it("renders disabled with a hint when the browser has notifications blocked", () => {
    render(<NotificationsToggle notifier={makeNotifier({ initial: "denied" })} />);
    expect(onSegment().disabled).toBe(true);
    expect(screen.getByText(/blocked in the browser/i)).toBeDefined();
  });
});
