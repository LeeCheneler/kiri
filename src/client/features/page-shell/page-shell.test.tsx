import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { PageShell } from "./page-shell.tsx";

describe("<PageShell>", () => {
  it("renders children as the main content", () => {
    render(<PageShell>route body</PageShell>);
    expect(within(screen.getByRole("main")).getByText("route body")).toBeDefined();
  });

  it("places left and right rail content outside the main region", () => {
    render(
      <PageShell left={<p>left rail</p>} right={<p>right rail</p>}>
        route body
      </PageShell>,
    );

    const main = screen.getByRole("main");
    expect(within(main).queryByText("left rail")).toBeNull();
    expect(within(main).queryByText("right rail")).toBeNull();

    const rails = screen.getAllByRole("complementary");
    expect(rails.some((rail) => within(rail).queryByText("left rail"))).toBe(true);
    expect(rails.some((rail) => within(rail).queryByText("right rail"))).toBe(true);
  });
});
