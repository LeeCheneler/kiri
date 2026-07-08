import { describe, expect, it } from "bun:test";
import type { HostEnvironment } from "./host-environment.ts";
import { buildWorkflowAuthoringGuide } from "./workflow-authoring-guide.ts";

const darwin: HostEnvironment = { platform: "darwin", release: "25.5.0", arch: "arm64" };
const linux: HostEnvironment = { platform: "linux", release: "6.8.0", arch: "x64" };
const other: HostEnvironment = { platform: "freebsd", release: "14.1", arch: "x64" };

describe("buildWorkflowAuthoringGuide", () => {
  it("carries a host-environment section naming the machine scripts run on", () => {
    const guide = buildWorkflowAuthoringGuide(darwin);
    expect(guide).toContain("## Host environment — scripts run on THIS machine");
    expect(guide).toContain("macOS (Darwin 25.5.0, arm64; BSD userland, not GNU)");
  });

  it("spells out the BSD-vs-GNU traps on a macOS host", () => {
    const guide = buildWorkflowAuthoringGuide(darwin);
    expect(guide).toContain("`sed -i ''`");
    expect(guide).toContain("`date` has no `-d`");
    expect(guide).toContain("`grep` has no `-P`");
    expect(guide).toContain("Linux-only");
  });

  it("warns against BSD/macOS forms on a Linux host", () => {
    const guide = buildWorkflowAuthoringGuide(linux);
    expect(guide).toContain("Linux (kernel 6.8.0, x64; GNU userland)");
    expect(guide).toContain("GNU sed takes bare `sed -i`");
    expect(guide).toContain("macOS-only");
  });

  it("falls back to verify-first guidance on an unrecognised platform", () => {
    const guide = buildWorkflowAuthoringGuide(other);
    expect(guide).toContain("platform `freebsd`");
    expect(guide).toContain("Verify any platform-specific flag");
  });

  it("requires POSIX sh, not bash, on every host", () => {
    for (const host of [darwin, linux, other]) {
      const guide = buildWorkflowAuthoringGuide(host);
      expect(guide).toContain("write POSIX sh");
      expect(guide).toContain("no `set -o pipefail`");
    }
  });
});
