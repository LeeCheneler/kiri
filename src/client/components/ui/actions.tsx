import type { ReactNode } from "react";
import { ErrorMessage } from "./error-message.tsx";

/**
 * Right-aligned action group hosting one or more buttons (`<Button>`,
 * `<TextButton>`) with an optional shared error slot below the row.
 * Use anywhere a page header, dialog footer, or section needs a row of
 * actions: the group owns positioning so the buttons stay layout-free.
 *
 * The `errorMessage` slot is shared across the row — consumers hoist
 * pending/error state to the parent and surface one message at a time,
 * matching how the modal already behaves.
 */
export function Actions({
  children,
  errorMessage = null,
}: {
  children: ReactNode;
  errorMessage?: string | null;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex items-baseline gap-4">{children}</div>
      <ErrorMessage message={errorMessage} />
    </div>
  );
}
