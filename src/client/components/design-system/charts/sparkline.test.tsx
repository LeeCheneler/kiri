import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Sparkline, type SparklineBar } from "./sparkline.tsx";

const bars = (...values: SparklineBar[]) => values;

describe("<Sparkline>", () => {
  it("labels the chart and draws one bar per datum with its tone", () => {
    render(
      <Sparkline
        label="Run durations"
        bars={bars(
          { value: 100, tone: "ok" },
          { value: 300, tone: "warm" },
          { value: 200, tone: "failed" },
        )}
      />,
    );
    const chart = screen.getByRole("img", { name: "Run durations" });
    const drawn = [...chart.querySelectorAll("[data-tone]")];
    expect(drawn.map((bar) => bar.getAttribute("data-tone"))).toEqual(["ok", "warm", "failed"]);
  });

  it("scales bar height to the largest value and floors near-zero bars", () => {
    render(
      <Sparkline
        label="durations"
        bars={bars({ value: 1000, tone: "ok" }, { value: 1, tone: "ok" })}
      />,
    );
    const drawn = [...screen.getByRole("img").querySelectorAll("[data-tone]")] as HTMLElement[];
    expect(drawn[0].style.height).toBe("100.0%");
    expect(drawn[1].style.height).toBe("12.0%");
  });

  it("floors every bar when all values are zero", () => {
    render(
      <Sparkline
        label="durations"
        bars={bars({ value: 0, tone: "ok" }, { value: 0, tone: "ok" })}
      />,
    );
    const drawn = [...screen.getByRole("img").querySelectorAll("[data-tone]")] as HTMLElement[];
    expect(drawn.every((bar) => bar.style.height === "12.0%")).toBe(true);
  });

  it("shows the per-bar label as a tooltip", () => {
    render(<Sparkline label="durations" bars={bars({ value: 1, tone: "ok", label: "0.8s" })} />);
    expect(screen.getByRole("img").querySelector("[data-tone]")?.getAttribute("title")).toBe(
      "0.8s",
    );
  });

  it("captions the axis ends when given", () => {
    render(
      <Sparkline
        label="durations"
        startLabel="oldest"
        endLabel="duration · now"
        bars={bars({ value: 1, tone: "ok" })}
      />,
    );
    expect(screen.getByText("oldest")).toBeDefined();
    expect(screen.getByText("duration · now")).toBeDefined();
  });

  it("omits the axis captions when none are given", () => {
    render(<Sparkline label="durations" bars={bars({ value: 1, tone: "ok" })} />);
    expect(screen.queryByText("oldest")).toBeNull();
    expect(screen.queryByText("duration · now")).toBeNull();
  });
});
