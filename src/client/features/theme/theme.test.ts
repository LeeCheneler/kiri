import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_THEME, THEMES, applyStoredTheme, currentTheme, setTheme } from "./theme.ts";

afterEach(() => {
  localStorage.removeItem("kiri:theme");
  delete document.documentElement.dataset.theme;
});

describe("theme preference", () => {
  it("defaults to the first theme when nothing is stored", () => {
    expect(currentTheme()).toBe(DEFAULT_THEME);
    expect(THEMES[0]?.id).toBe(DEFAULT_THEME);
  });

  it("falls back to the default when the stored value is not a theme", () => {
    localStorage.setItem("kiri:theme", "neon");
    expect(currentTheme()).toBe(DEFAULT_THEME);
  });

  it("stamps the stored theme on the document at boot without rewriting it", () => {
    localStorage.setItem("kiri:theme", "terminal");
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("terminal");
    localStorage.setItem("kiri:theme", "neon");
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
    expect(localStorage.getItem("kiri:theme")).toBe("neon");
  });

  it("persists the chosen theme and stamps it on the document", () => {
    setTheme("glacier");
    expect(currentTheme()).toBe("glacier");
    expect(localStorage.getItem("kiri:theme")).toBe("glacier");
    expect(document.documentElement.dataset.theme).toBe("glacier");
  });
});
