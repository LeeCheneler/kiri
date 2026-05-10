import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useLiveEvent } from "../events/live.tsx";

const DEFAULT_AUTO_DISMISS_MS = 6000;
const RUN_PATH_PREFIX = "/runs/";

type ToastStatus = "ok" | "failed";

interface ToastEntry {
  id: number;
  runId: string;
  workflowName: string;
  status: ToastStatus;
}

const STRIP_BG: Record<ToastStatus, string> = {
  ok: "bg-status-ok",
  failed: "bg-status-failed",
};

const STATUS_TEXT: Record<ToastStatus, string> = {
  ok: "text-status-ok",
  failed: "text-status-failed",
};

const activeRunIdFor = (location: string): string | null => {
  if (!location.startsWith(RUN_PATH_PREFIX)) return null;
  return location.slice(RUN_PATH_PREFIX.length);
};

/**
 * Bottom-right stack of completion toasts. Subscribes to `run.finished`
 * events and pushes a card for each run that ends, except when the user
 * is already on the matching `/runs/:id` — they're watching it. Each
 * toast auto-dismisses after `autoDismissMs` (default 6s); clicking the
 * body navigates to the run, the X dismisses immediately. The stack
 * region is `aria-live="polite"` so completions are announced without
 * stealing focus.
 *
 * Stack ordering: oldest at the top, newest at the bottom — newer
 * arrivals push older ones up, keeping the most recent closest to the
 * corner anchor.
 *
 * `autoDismissMs` is a test seam — production omits it.
 */
export function ToastContainer({
  autoDismissMs = DEFAULT_AUTO_DISMISS_MS,
}: { autoDismissMs?: number } = {}) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [location] = useLocation();
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  useLiveEvent({
    on: ["run.finished"],
    handler: (event) => {
      // The `run.finished` payload's status union still includes "running"
      // — terminal-only is a runtime invariant, not a type guarantee. Skip
      // anything that wouldn't render with a real status colour.
      const status: ToastStatus | null =
        event.status === "ok" || event.status === "failed" ? event.status : null;
      if (!status) return;
      if (activeRunIdFor(location) === event.id) return;
      const id = ++idRef.current;
      setToasts((current) => [
        ...current,
        { id, runId: event.id, workflowName: event.workflowName, status },
      ]);
    },
  });

  return (
    // <output> carries implicit role="status"; aria-live is set explicitly so
    // assistive tech announces arrivals politely without stealing focus.
    <output
      aria-live="polite"
      className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col gap-3"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          autoDismissMs={autoDismissMs}
          onDismiss={() => dismiss(toast.id)}
        />
      ))}
    </output>
  );
}

function ToastCard({
  toast,
  autoDismissMs,
  onDismiss,
}: {
  toast: ToastEntry;
  autoDismissMs: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(handle);
  }, [autoDismissMs, onDismiss]);

  return (
    <div className="pointer-events-auto relative w-80 border border-rule bg-paper shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${STRIP_BG[toast.status]}`}
      />
      <Link
        href={`/runs/${toast.runId}`}
        className="block py-3 pr-12 pl-5 no-underline outline-none transition-colors duration-150 hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
      >
        <div className={`text-xs tracking-widest uppercase ${STATUS_TEXT[toast.status]}`}>
          {toast.status}
        </div>
        <div className="mt-1.5 font-display text-lg text-ink leading-tight">
          {toast.workflowName}
        </div>
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute top-1.5 right-1.5 cursor-pointer px-2 py-1 font-mono text-sm leading-none text-ink-muted no-underline outline-none transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent"
      >
        ×
      </button>
    </div>
  );
}
