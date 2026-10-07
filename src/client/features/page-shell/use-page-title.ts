import { useEffect } from "react";

/** Sets the browser tab title for the current page; resets to Kiri on unmount. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Kiri`;
    return () => {
      document.title = "Kiri";
    };
  }, [title]);
}
