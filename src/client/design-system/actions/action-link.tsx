import type { ReactNode } from "react";
import { Link } from "wouter";
import { isExternalHref } from "../utils/is-external-href.ts";

/** A prominent navigation link. Use one primary destination per surface; inline prose uses InlineLink. */
export function ActionLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "default";
}) {
  const className = `inline-flex items-center justify-center border px-5 py-3 font-mono text-sm no-underline transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
    variant === "primary"
      ? "border-accent bg-accent text-canvas hover:bg-transparent hover:text-accent"
      : "border-rule text-ink hover:border-accent hover:text-accent"
  }`;
  if (href.startsWith("#") || isExternalHref(href)) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
