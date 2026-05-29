/**
 * Whether a link `href` points outside the app. Empty hrefs, in-app paths
 * (`/runs/1`), and fragments (`#top`) are internal; anything that resolves to a
 * different origin — an `https:` or `mailto:` URL, say — is external. A
 * malformed href is treated as internal rather than throwing.
 */
export const isExternalHref = (href: string): boolean => {
  if (href.length === 0) return false;
  if (href.startsWith("#") || href.startsWith("/")) return false;
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
};
