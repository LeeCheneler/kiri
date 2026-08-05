/** Content of one desktop notification, plus the click behaviour it carries. */
export interface DesktopNotificationSpec {
  title: string;
  body: string;
  /** Stable per-entity tag so a re-fired event replaces its notification rather than stacking. */
  tag: string;
  onClick: () => void;
}

/**
 * Seam over the browser's `Notification` API so notification behaviour is
 * drivable in tests, mirroring the live bus's `EventSourceFactory` seam.
 */
export interface Notifier {
  /** Current permission state; `denied` when the browser has no Notification support. */
  permission(): NotificationPermission;
  /** Prompt for permission. Browsers require a user gesture, so call from an event handler. */
  requestPermission(): Promise<NotificationPermission>;
  /** Show a notification. Clicking it focuses the window, then runs `onClick`. */
  show(spec: DesktopNotificationSpec): void;
}

// Read lazily rather than at module load: the global is absent in unsupported
// environments, and tests install a fake after import.
const notificationCtor = (): typeof Notification | undefined =>
  (globalThis as { Notification?: typeof Notification }).Notification;

/** Production `Notifier` backed by the browser's `Notification` global. */
export const defaultNotifier: Notifier = {
  permission: () => notificationCtor()?.permission ?? "denied",
  requestPermission: async () => (await notificationCtor()?.requestPermission()) ?? "denied",
  show: (spec) => {
    const ctor = notificationCtor();
    if (!ctor) return;
    const notification = new ctor(spec.title, {
      body: spec.body,
      tag: spec.tag,
      icon: "/kiri.png",
    });
    notification.onclick = () => {
      window.focus();
      spec.onClick();
    };
  },
};

const PREFERENCE_KEY = "kiri:desktop-notifications";

/** Whether the user has switched desktop notifications on. */
export const desktopNotificationsEnabled = (): boolean =>
  localStorage.getItem(PREFERENCE_KEY) === "on";

/** Persist the desktop-notifications switch. */
export const setDesktopNotificationsEnabled = (enabled: boolean): void => {
  if (enabled) localStorage.setItem(PREFERENCE_KEY, "on");
  else localStorage.removeItem(PREFERENCE_KEY);
};
