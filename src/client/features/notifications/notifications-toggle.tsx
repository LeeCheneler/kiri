import { useState } from "react";
import { SegmentedControl } from "../../design-system/actions/segmented-control.tsx";
import {
  type Notifier,
  defaultNotifier,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "./notifier.ts";

/**
 * Rail switch for desktop notifications. Enabling prompts for browser
 * permission — which must happen inside the click gesture — and persists the
 * preference only once granted; while the browser has notifications blocked
 * the switch is disabled with a hint explaining why.
 *
 * `notifier` is a test seam — production callers omit it and get the
 * browser's `Notification` API.
 */
export function NotificationsToggle({ notifier = defaultNotifier }: { notifier?: Notifier } = {}) {
  const [enabled, setEnabled] = useState(desktopNotificationsEnabled);
  const [permission, setPermission] = useState(notifier.permission);

  const onChange = async (next: "on" | "off") => {
    if (next === "off") {
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
  return (
    <SegmentedControl
      label="Desktop notifications"
      options={[
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
      value={enabled ? "on" : "off"}
      onChange={(next) => void onChange(next)}
      disabled={denied}
      description={denied ? "Blocked in the browser's site settings." : undefined}
    />
  );
}
