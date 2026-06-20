/**
 * Whether a link `href` should open as a real browser navigation rather than a
 * client-side route. Empty hrefs, in-app paths (`/runs/1`), and fragments
 * (`#top`) stay in-app; anything that resolves to a different origin — an
 * `https:` or `mailto:` URL, say — is external. A malformed href is treated as
 * internal rather than throwing.
 */
export const isExternalHref = (href: string): boolean => {
  if (href.length === 0 || href.startsWith("#")) return false;
  try {
    const { origin } = new URL(href, window.location.href);
    return origin !== window.location.origin;
  } catch {
    return false;
  }
};
