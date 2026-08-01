import { type ReactNode, useId } from "react";

/**
 * One labelled band of a repo's page — a heading, an optional action sitting
 * with it on the rule, and the section's own content below. The repo page is a
 * stack of these, so a new concern (a fetch/pull panel, a changeset viewer)
 * arrives as another `RepoSection` in the stack rather than a reshuffle of the
 * page. The `<section>` is labelled by its heading, so each band is a landmark
 * a reader can jump to by name.
 */
export function RepoSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-rule border-b pb-3">
        <h3 id={headingId} className="font-display text-2xl text-ink leading-none">
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
