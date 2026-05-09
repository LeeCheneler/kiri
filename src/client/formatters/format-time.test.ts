import { describe, expect, it } from "bun:test";
import { formatDuration, formatDurationMs, formatRelativeTime } from "./format-time.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");
const isoOffset = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();

describe("formatRelativeTime", () => {
  it("renders sub-second deltas as 'now'", () => {
    expect(formatRelativeTime(isoOffset(-0.4), NOW)).toBe("now");
  });

  it("renders second-scale deltas in seconds", () => {
    expect(formatRelativeTime(isoOffset(-30), NOW)).toBe("30 seconds ago");
  });

  it("renders minute-scale deltas in minutes", () => {
    expect(formatRelativeTime(isoOffset(-3 * 60), NOW)).toBe("3 minutes ago");
  });

  it("renders hour-scale deltas in hours", () => {
    expect(formatRelativeTime(isoOffset(-2 * 60 * 60), NOW)).toBe("2 hours ago");
  });

  it("renders day-scale deltas as 'yesterday' when numeric: 'auto' applies", () => {
    expect(formatRelativeTime(isoOffset(-24 * 60 * 60), NOW)).toBe("yesterday");
  });

  it("renders multi-day deltas in days", () => {
    expect(formatRelativeTime(isoOffset(-3 * 24 * 60 * 60), NOW)).toBe("3 days ago");
  });

  it("renders month-scale deltas in months", () => {
    expect(formatRelativeTime(isoOffset(-60 * 24 * 60 * 60), NOW)).toBe("2 months ago");
  });

  it("renders year-scale deltas in years", () => {
    expect(formatRelativeTime(isoOffset(-2 * 365 * 24 * 60 * 60), NOW)).toBe("2 years ago");
  });

  it("uses the system clock when 'now' is omitted", () => {
    // Just-now: "now" with numeric: "auto". Asserts the optional arg has a sensible default.
    expect(formatRelativeTime(new Date().toISOString())).toBe("now");
  });
});

describe("formatDuration", () => {
  const start = "2026-05-09T12:00:00.000Z";
  const finish = (msAfter: number) => new Date(new Date(start).getTime() + msAfter).toISOString();

  it("renders sub-second durations in milliseconds", () => {
    expect(formatDuration(start, finish(420))).toBe("420ms");
  });

  it("renders sub-10s durations with one decimal place", () => {
    expect(formatDuration(start, finish(1_400))).toBe("1.4s");
  });

  it("renders sub-minute durations in whole seconds", () => {
    expect(formatDuration(start, finish(12_000))).toBe("12s");
  });

  it("renders whole-minute durations without a seconds suffix", () => {
    expect(formatDuration(start, finish(2 * 60_000))).toBe("2m");
  });

  it("renders minute+seconds durations with both parts", () => {
    expect(formatDuration(start, finish(2 * 60_000 + 30_000))).toBe("2m 30s");
  });

  it("renders whole-hour durations without a minutes suffix", () => {
    expect(formatDuration(start, finish(2 * 60 * 60_000))).toBe("2h");
  });

  it("renders hour+minutes durations with both parts", () => {
    expect(formatDuration(start, finish(60 * 60_000 + 5 * 60_000))).toBe("1h 5m");
  });

  it("clamps a negative gap to zero", () => {
    expect(formatDuration(finish(1_000), start)).toBe("0ms");
  });
});

describe("formatDurationMs", () => {
  it("renders sub-second durations in milliseconds", () => {
    expect(formatDurationMs(420)).toBe("420ms");
  });

  it("rounds fractional millisecond inputs", () => {
    expect(formatDurationMs(420.7)).toBe("421ms");
  });

  it("renders sub-10s durations with one decimal place", () => {
    expect(formatDurationMs(1_400)).toBe("1.4s");
  });

  it("renders sub-minute durations in whole seconds", () => {
    expect(formatDurationMs(12_000)).toBe("12s");
  });

  it("renders minute+seconds durations with both parts", () => {
    expect(formatDurationMs(2 * 60_000 + 30_000)).toBe("2m 30s");
  });

  it("renders hour+minutes durations with both parts", () => {
    expect(formatDurationMs(60 * 60_000 + 5 * 60_000)).toBe("1h 5m");
  });

  it("clamps negative inputs to zero", () => {
    expect(formatDurationMs(-50)).toBe("0ms");
  });
});
