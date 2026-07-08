import { describe, expect, it } from "bun:test";
import { describeHost, detectHostEnvironment } from "./host-environment.ts";

describe("detectHostEnvironment", () => {
  it("reports the running process's platform, kernel release, and architecture", () => {
    const host = detectHostEnvironment();
    expect(host.platform).toBe(process.platform);
    expect(host.release.length).toBeGreaterThan(0);
    expect(host.arch.length).toBeGreaterThan(0);
  });
});

describe("describeHost", () => {
  it("names macOS with its BSD userland for darwin", () => {
    expect(describeHost({ platform: "darwin", release: "25.5.0", arch: "arm64" })).toBe(
      "macOS (Darwin 25.5.0, arm64; BSD userland, not GNU)",
    );
  });

  it("names Linux with its GNU userland", () => {
    expect(describeHost({ platform: "linux", release: "6.8.0", arch: "x64" })).toBe(
      "Linux (kernel 6.8.0, x64; GNU userland)",
    );
  });

  it("falls back to the raw platform identifier elsewhere", () => {
    expect(describeHost({ platform: "freebsd", release: "14.1", arch: "x64" })).toBe(
      "freebsd (14.1, x64)",
    );
  });
});
