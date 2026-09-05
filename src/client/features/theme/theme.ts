/** One selectable look. `id` matches a `[data-theme]` block in `app.css`. */
export interface Theme {
  id: ThemeId;
  name: string;
  tagline: string;
}

export type ThemeId =
  | "ledger"
  | "gazette"
  | "parchment"
  | "terminal"
  | "glacier"
  | "damask"
  | "oxide"
  | "indigo"
  | "graphite";

/** Every theme the picker offers, in display order. The first is the default. */
export const THEMES: readonly Theme[] = [
  { id: "ledger", name: "Ledger", tagline: "warm dark, gilt" },
  { id: "gazette", name: "Gazette", tagline: "newsprint white" },
  { id: "parchment", name: "Parchment", tagline: "cream and sienna" },
  { id: "terminal", name: "Terminal", tagline: "phosphor on black" },
  { id: "glacier", name: "Glacier", tagline: "slate and ice" },
  { id: "damask", name: "Damask", tagline: "plum and rose" },
  { id: "oxide", name: "Oxide", tagline: "charcoal and copper" },
  { id: "indigo", name: "Indigo", tagline: "navy and lilac" },
  { id: "graphite", name: "Graphite", tagline: "neutral greys" },
];

export const DEFAULT_THEME: ThemeId = "ledger";

// Also read by the inline script in index.html, which applies the stored
// theme before first paint so the page never flashes the default.
const PREFERENCE_KEY = "kiri:theme";

const isThemeId = (value: string | null): value is ThemeId =>
  THEMES.some((theme) => theme.id === value);

/** The persisted theme, or the default when nothing (or something unknown) is stored. */
export const currentTheme = (): ThemeId => {
  const stored = localStorage.getItem(PREFERENCE_KEY);
  return isThemeId(stored) ? stored : DEFAULT_THEME;
};

/** Persist a theme and stamp it on the document so the CSS block takes over. */
export const setTheme = (id: ThemeId): void => {
  localStorage.setItem(PREFERENCE_KEY, id);
  document.documentElement.dataset.theme = id;
};
