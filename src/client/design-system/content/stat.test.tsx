import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Stat, StatList } from "./stat.tsx";

describe("<StatList>", () => {
  it("renders its stats as a description list of term/value pairs", () => {
    render(
      <StatList>
        <Stat label="Runs">9</Stat>
        <Stat label="Ok" tone="ok">
          8
        </Stat>
      </StatList>,
    );
    expect(screen.getAllByRole("term").map((el) => el.textContent)).toEqual(["Runs", "Ok"]);
    expect(screen.getAllByRole("definition").map((el) => el.textContent)).toEqual(["9", "8"]);
  });
});

describe("<Stat>", () => {
  it("renders the label and its figure", () => {
    render(<Stat label="Avg duration">601ms</Stat>);
    expect(screen.getByText("Avg duration")).toBeDefined();
    expect(screen.getByText("601ms")).toBeDefined();
  });

  it("defaults to the neutral tone exposed via data-tone", () => {
    const { container } = render(<Stat label="Runs">9</Stat>);
    expect(container.querySelector('[data-tone="default"]')).not.toBeNull();
  });

  it("reflects the ok tone via data-tone", () => {
    const { container } = render(
      <Stat label="Ok" tone="ok">
        8
      </Stat>,
    );
    expect(container.querySelector('[data-tone="ok"]')).not.toBeNull();
  });

  it("reflects the failed tone via data-tone", () => {
    const { container } = render(
      <Stat label="Failed" tone="failed">
        1
      </Stat>,
    );
    expect(container.querySelector('[data-tone="failed"]')).not.toBeNull();
  });
});
