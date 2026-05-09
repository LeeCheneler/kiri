import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./app.tsx";

afterEach(() => cleanup());

describe("<App>", () => {
  it("renders the kiri heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /kiri/i })).toBeDefined();
  });
});
