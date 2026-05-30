/**
 * Whether a link `href` should open as a real browser navigation rather than a
 * client-side route. Empty hrefs, in-app paths (`/runs/1`), and fragments
 * (`#top`) stay in-app; anything that resolves to a different origin — an
 * `https:` or `mailto:` URL, say — is external. The hosted docs under `/docs`
 * are a static site served outside the SPA, so they are external too, even when
 * they share the app's origin. A malformed href is treated as internal rather
 * than throwing.
 */
export const isExternalHref = (href: string): boolean => {
  if (href.length === 0 || href.startsWith("#")) return false;
  try {
    const { origin, pathname } = new URL(href, window.location.href);
    if (pathname === "/docs" || pathname.startsWith("/docs/")) return true;
    return origin !== window.location.origin;
  } catch {
    return false;
  }
};
