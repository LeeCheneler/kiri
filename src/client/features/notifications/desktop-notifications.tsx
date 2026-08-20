import { useLocation } from "wouter";
import { fetchRun, fetchSession } from "../../api.ts";
import { useLiveEvent } from "../../events/live.tsx";
import { type Notifier, defaultNotifier, desktopNotificationsEnabled } from "./notifier.ts";

/**
 * Bridges completion events to desktop notifications: a workflow run
 * finishing or a session settling pops a system notification that opens the
 * entity when clicked. Suppressed while the tab is focused on that entity's
 * page — the user is already watching it — and inert until the user enables
 * notifications and the browser grants permission. Renders nothing; mount
 * once inside `<LiveEventsProvider>`.
 *
 * `notifier` is a test seam — production callers omit it and get the
 * browser's `Notification` API.
 */
export function DesktopNotifications({
  notifier = defaultNotifier,
}: { notifier?: Notifier } = {}): null {
  const [location, navigate] = useLocation();

  const suppressed = (path: string): boolean =>
    !desktopNotificationsEnabled() ||
    notifier.permission() !== "granted" ||
    (document.hasFocus() && location.startsWith(path));

  useLiveEvent({
    on: ["run.finished"],
    handler: (event) => {
      const path = `/runs/${event.id}`;
      if (suppressed(path)) return;
      void fetchRun(event.id).then(({ run }) => {
        notifier.show({
          title: run.workflowName,
          body: `Workflow finished · ${event.status}`,
          tag: event.id,
          onClick: () => navigate(path),
        });
      });
    },
  });

  useLiveEvent({
    on: ["session.updated", "session.finished"],
    handler: (event) => {
      // A turn ending normally is `session.updated` → idle, or → waiting when
      // it paused on tool approval; `session.finished` carries the terminal
      // failed/cancelled. Other statuses are mid-turn.
      const settled =
        event.type === "session.finished" || event.status === "idle" || event.status === "waiting";
      if (!settled) return;
      const path = `/sessions/${event.id}`;
      if (suppressed(path)) return;
      void fetchSession(event.id).then(({ session }) => {
        // Delegate children are internal workers, not a surface the user watches.
        if (session.parentSessionId !== null) return;
        notifier.show({
          title: session.title ?? "Session",
          body:
            event.status === "idle"
              ? "Finished working"
              : event.status === "waiting"
                ? "Waiting for tool approval"
                : `Session ${event.status}`,
          tag: event.id,
          onClick: () => navigate(path),
        });
      });
    },
  });

  return null;
}
