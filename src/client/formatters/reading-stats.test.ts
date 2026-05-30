import { describe, expect, it } from "bun:test";
import { readingStats } from "./reading-stats.ts";

const repeatWords = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("readingStats", () => {
  it("counts prose words and ignores markdown punctuation tokens", () => {
    expect(readingStats("# The quick brown fox").words).toBe("4 words");
  });

  it("treats a one-word body as singular", () => {
    expect(readingStats("solo").words).toBe("1 word");
  });

  it("reports an empty body as zero words and a one-minute read", () => {
    const stats = readingStats("   \n  ");
    expect(stats.words).toBe("0 words");
    expect(stats.readingTime).toBe("1 min read");
  });

  it("groups large word counts with a thousands separator", () => {
    expect(readingStats(repeatWords(1500)).words).toBe("1,500 words");
  });

  it("estimates reading time at ~200 words per minute, rounding up", () => {
    // 250 words → ceil(250 / 200) = 2 minutes.
    expect(readingStats(repeatWords(250)).readingTime).toBe("2 min read");
  });
});
