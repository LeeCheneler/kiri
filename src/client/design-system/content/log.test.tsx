import { afterEach, describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Log } from "./log.tsx";

// happy-dom lays nothing out, so overflow is simulated by pinning the
// measured heights on the prototype for the duration of a test.
const simulateHeights = (scroll: number, client: number) => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scroll,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => client,
  });
};

describe("<Log>", () => {
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: restore the prototype's own getters
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    // biome-ignore lint/performance/noDelete: restore the prototype's own getters
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("shows no action when the output fits", () => {
    simulateHeights(40, 40);
    render(<Log>one line</Log>);
    expect(screen.getByText("one line")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers show more when the output overflows, and toggles to show less", async () => {
    simulateHeights(400, 145);
    render(<Log lines={10}>{"a\n".repeat(30)}</Log>);
    const more = screen.getByRole("button", { name: "show more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(more);
    const less = screen.getByRole("button", { name: "show less" });
    expect(less.getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(less);
    expect(screen.getByRole("button", { name: "show more" })).toBeDefined();
  });

  it("re-measures on window resize", () => {
    simulateHeights(40, 40);
    render(<Log>line</Log>);
    expect(screen.queryByRole("button")).toBeNull();

    simulateHeights(400, 145);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("button", { name: "show more" })).toBeDefined();
  });
});
