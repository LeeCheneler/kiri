import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  defaultNotifier,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "./notifier.ts";

// Test double for the browser's Notification constructor, installed on
// globalThis so `defaultNotifier`'s lazy lookup finds it.
class FakeNotification {
  static permission: NotificationPermission = "default";
  static requested = 0;
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;

  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.requested++;
    return "granted";
  }
}

const installFakeNotification = (): typeof FakeNotification => {
  FakeNotification.permission = "default";
  FakeNotification.requested = 0;
  FakeNotification.instances = [];
  (globalThis as { Notification?: unknown }).Notification = FakeNotification;
  return FakeNotification;
};

afterEach(() => {
  (globalThis as { Notification?: unknown }).Notification = undefined;
  setDesktopNotificationsEnabled(false);
});

describe("defaultNotifier", () => {
  it("reports denied and shows nothing when the browser lacks Notification support", async () => {
    expect(defaultNotifier.permission()).toBe("denied");
    expect(await defaultNotifier.requestPermission()).toBe("denied");
    // No-op rather than a throw.
    defaultNotifier.show({ title: "t", body: "b", tag: "tag", onClick: () => {} });
  });

  it("reflects the browser's permission state", () => {
    const fake = installFakeNotification();
    expect(defaultNotifier.permission()).toBe("default");
    fake.permission = "granted";
    expect(defaultNotifier.permission()).toBe("granted");
  });

  it("delegates permission prompts to the browser", async () => {
    const fake = installFakeNotification();
    expect(await defaultNotifier.requestPermission()).toBe("granted");
    expect(fake.requested).toBe(1);
  });

  it("shows a notification carrying the body, tag, and kiri icon", () => {
    const fake = installFakeNotification();
    defaultNotifier.show({ title: "deploy", body: "finished", tag: "r1", onClick: () => {} });
    expect(fake.instances).toHaveLength(1);
    const shown = fake.instances[0] as FakeNotification;
    expect(shown.title).toBe("deploy");
    expect(shown.options).toEqual({ body: "finished", tag: "r1", icon: "/kiri.png" });
  });

  it("focuses the window and runs onClick when the notification is clicked", () => {
    const fake = installFakeNotification();
    const focus = spyOn(window, "focus");
    let clicked = 0;
    defaultNotifier.show({ title: "t", body: "b", tag: "tag", onClick: () => clicked++ });
    (fake.instances[0] as FakeNotification).onclick?.();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(clicked).toBe(1);
    focus.mockRestore();
  });
});

describe("desktop notifications preference", () => {
  it("defaults off, persists on, and clears back off", () => {
    expect(desktopNotificationsEnabled()).toBe(false);
    setDesktopNotificationsEnabled(true);
    expect(desktopNotificationsEnabled()).toBe(true);
    setDesktopNotificationsEnabled(false);
    expect(desktopNotificationsEnabled()).toBe(false);
  });
});
