import { useEffect, useState } from "react";

/**
 * The latest `value` that has held still for `delayMs`. Each change restarts
 * the timer, so a query keyed on the result fires once per pause in typing
 * rather than once per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
