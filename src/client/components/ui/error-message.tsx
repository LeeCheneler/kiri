/**
 * Inline alert paragraph rendered beneath an action when an operation
 * rejects. Returns null on an absent message so callers can pass their
 * error state straight through without gating the render themselves.
 */
export function ErrorMessage({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="mt-2 max-w-xs font-mono text-xs text-status-failed normal-case">
      {message}
    </p>
  );
}
