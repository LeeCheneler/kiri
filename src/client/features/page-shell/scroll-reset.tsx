import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Scrolls the window back to the top whenever the route changes. Client-side
 * navigation keeps the previous page's scroll offset — leaving a long article
 * would otherwise land mid-feed, and entering one would start mid-article —
 * so every route transition starts at the top, matching a full page load.
 * Renders nothing; mount once at the app root, before the route switch so
 * a page's own scroll positioning (e.g. the chat's pin-to-bottom) wins.
 */
export function ScrollReset(): null {
  const [location] = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route is the trigger — scroll fires on every location change, nothing inside the effect reads it
  useEffect(() => {
    // `behavior: "instant"` opts out of the document's smooth scroll-behavior:
    // a page swap should land at the top, not animate there.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);
  return null;
}
