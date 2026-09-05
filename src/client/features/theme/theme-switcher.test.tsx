import { afterEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeSwitcher } from "./theme-switcher.tsx";
import { THEMES, currentTheme } from "./theme.ts";

const trigger = () => screen.getByRole("button", { name: "Theme" });
// The accessible name is the swatch label's full text (name plus tagline).
const swatch = (name: string) =>
  screen.getByRole("radio", { name: new RegExp(`^${name}`) }) as HTMLInputElement;

afterEach(() => {
  localStorage.removeItem("kiri:theme");
  delete document.documentElement.dataset.theme;
});

describe("<ThemeSwitcher>", () => {
  it("opens a panel listing every theme with the current one checked", () => {
    render(<ThemeSwitcher />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog", { name: "Theme" })).toBeDefined();
    expect(screen.getAllByRole("radio")).toHaveLength(THEMES.length);
    expect(swatch("Ledger").checked).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("renders each swatch in its own theme", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(trigger());
    expect(swatch("Terminal").closest("label")?.dataset.theme).toBe("terminal");
  });

  it("applies and persists a chosen theme", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(trigger());
    fireEvent.click(swatch("Damask"));
    expect(swatch("Damask").checked).toBe(true);
    expect(currentTheme()).toBe("damask");
    expect(document.documentElement.dataset.theme).toBe("damask");
  });

  it("starts on the persisted theme", () => {
    localStorage.setItem("kiri:theme", "oxide");
    render(<ThemeSwitcher />);
    fireEvent.click(trigger());
    expect(swatch("Oxide").checked).toBe(true);
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(trigger());
    swatch("Ledger").focus();
    fireEvent.keyDown(swatch("Ledger"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("ignores other keys and Escape while closed", () => {
    render(<ThemeSwitcher />);
    fireEvent.keyDown(trigger(), { key: "Escape" });
    fireEvent.click(trigger());
    fireEvent.keyDown(swatch("Ledger"), { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("closes on a pointer-down outside, not inside", () => {
    render(
      <div>
        <ThemeSwitcher />
        <p>outside</p>
      </div>,
    );
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles closed from the button", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
});
