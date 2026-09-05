import { useState } from "react";
import {
  type Notifier,
  defaultNotifier,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "./notifier.ts";

/**
 * Rail switch for desktop notifications: a round bell button that toggles the
 * preference; the bell fills and takes the accent while notifications are on. Enabling prompts for browser
 * permission — which must happen inside the click gesture — and persists the
 * preference only once granted; while the browser has notifications blocked
 * the button is disabled with a tooltip explaining why.
 *
 * `notifier` is a test seam — production callers omit it and get the
 * browser's `Notification` API.
 */
export function NotificationsToggle({ notifier = defaultNotifier }: { notifier?: Notifier } = {}) {
  const [enabled, setEnabled] = useState(desktopNotificationsEnabled);
  const [permission, setPermission] = useState(notifier.permission);

  const toggle = async () => {
    if (enabled) {
      setDesktopNotificationsEnabled(false);
      setEnabled(false);
      return;
    }
    const granted = (await notifier.requestPermission()) === "granted";
    setPermission(notifier.permission());
    setDesktopNotificationsEnabled(granted);
    setEnabled(granted);
  };

  const denied = permission === "denied";
  const title = denied
    ? "Desktop notifications are blocked in the browser's site settings."
    : `Desktop notifications ${enabled ? "on" : "off"}`;

  return (
    <button
      type="button"
      aria-label="Desktop notifications"
      aria-pressed={enabled}
      title={title}
      disabled={denied}
      onClick={() => void toggle()}
      className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-rule bg-paper outline-none transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? "text-accent" : "text-ink-muted"
      }`}
    >
      {/* A bell, filled while notifications are on. */}
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
        <path
          d="M8 1.75a3.75 3.75 0 0 0-3.75 3.75v2.6L3 10.25V11h10v-.75L11.75 8.1V5.5A3.75 3.75 0 0 0 8 1.75Z"
          fill={enabled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 13.25a1.5 1.5 0 0 0 3 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
