import { describe, expect, it } from "bun:test";
import { mapConcurrent } from "./concurrency.ts";

describe("mapConcurrent", () => {
  it("returns results in input order however they interleave", async () => {
    const items = [30, 0, 10, 20, 5];
    const results = await mapConcurrent(items, 2, async (ms) => {
      await Bun.sleep(ms);
      return `done:${ms}`;
    });
    expect(results).toEqual(["done:30", "done:0", "done:10", "done:20", "done:5"]);
  });

  it("keeps at most `limit` calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapConcurrent([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(1);
      inFlight -= 1;
      return item;
    });
    expect(peak).toBe(3);
  });

  it("runs nothing for no items", async () => {
    expect(await mapConcurrent([], 4, async () => "never")).toEqual([]);
  });
});
