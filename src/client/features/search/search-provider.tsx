import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { SearchOverlay } from "./search-overlay.tsx";

interface SearchOverlayContextValue {
  /** Open the search overlay. */
  openSearch: () => void;
}

const SearchOverlayContext = createContext<SearchOverlayContextValue | null>(null);

/**
 * Owns the search overlay: renders it over `children` while open. Opened
 * from any descendant via `useSearchOverlay`, or from anywhere with the
 * global ⌘K / Ctrl+K shortcut, which toggles. Mount once at the root so the
 * shortcut works on every page.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SearchOverlayContext.Provider value={{ openSearch: () => setOpen(true) }}>
      {children}
      {open ? <SearchOverlay onClose={() => setOpen(false)} /> : null}
    </SearchOverlayContext.Provider>
  );
}

/** The search-overlay controls from the nearest `<SearchProvider>`. */
export function useSearchOverlay(): SearchOverlayContextValue {
  const ctx = useContext(SearchOverlayContext);
  if (!ctx) throw new Error("useSearchOverlay must be used inside <SearchProvider>");
  return ctx;
}
