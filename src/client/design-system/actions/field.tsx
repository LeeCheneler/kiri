import type { ReactNode } from "react";

/**
 * The label-and-help lockup shared by the form controls. Renders a mono
 * uppercase `<label>` — with a quiet accent asterisk when `required` — over an
 * optional italic help line, then the control itself. `htmlFor` ties the label
 * to the control and seeds the help line's id as `${htmlFor}-description`, which
 * the control points its `aria-describedby` at, so the help text is announced as
 * the field's description. The asterisk is decorative (`aria-hidden`); the
 * control's own `aria-required` carries the requirement for assistive tech. It
 * owns the vertical rhythm between label, help, and control — nothing outside.
 */
export function Field({
  htmlFor,
  label,
  description,
  required = false,
  children,
}: {
  htmlFor: string;
  label: string;
  description?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="font-mono text-xs tracking-widest text-ink-muted uppercase"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent">
            *
          </span>
        )}
      </label>
      {description && (
        <p id={`${htmlFor}-description`} className="font-display text-sm text-ink-muted italic">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}
