import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Tracks whether the referenced element is on screen, for gating
 * scroll-triggered animations. Flips back to false when the element leaves the
 * viewport so an animation can replay on re-entry. Falls back to always-true
 * when IntersectionObserver is unavailable, so content is never left hidden.
 */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, inView];
}
