import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { VersionInfo, compareVersions } from "./version-info.tsx";

const releaseUrl = "https://api.github.com/repos/LeeCheneler/kiri/releases/latest";

const renderFooter = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <VersionInfo />
    </QueryClientProvider>,
  );

describe("compareVersions", () => {
  it("returns -1 / 0 / 1 for numerically ordered semver-ish strings", () => {
    expect(compareVersions("v0.1.0", "v0.2.0")).toBe(-1);
    expect(compareVersions("v0.2.0", "v0.2.0")).toBe(0);
    expect(compareVersions("v1.0.0", "v0.9.9")).toBe(1);
  });

  it("tolerates the leading 'v' on one side", () => {
    expect(compareVersions("0.1.0", "v0.2.0")).toBe(-1);
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
  });

  it("treats missing patch parts as zero", () => {
    expect(compareVersions("v0.1", "v0.1.0")).toBe(0);
    expect(compareVersions("v0.1", "v0.1.1")).toBe(-1);
  });

  it("ignores pre-release and build suffixes", () => {
    expect(compareVersions("v0.2.0-rc1", "v0.2.0")).toBe(0);
    expect(compareVersions("v0.2.0+build.5", "v0.2.0")).toBe(0);
  });

  it("returns 0 when either side is unparseable", () => {
    expect(compareVersions("dev", "v0.2.0")).toBe(0);
    expect(compareVersions("v0.2.0", "weird-tag")).toBe(0);
    expect(compareVersions("", "v0.2.0")).toBe(0);
  });
});

describe("<VersionInfo>", () => {
  it("renders the running version once /api/version resolves", async () => {
    server.use(http.get("*/api/version", () => HttpResponse.json({ version: "v0.1.0" })));
    renderFooter();
    expect(await screen.findByText("v0.1.0")).toBeDefined();
    await flushAsync();
  });

  it("renders nothing when /api/version fails", async () => {
    server.use(http.get("*/api/version", () => new HttpResponse("boom", { status: 500 })));
    const { container } = renderFooter();
    await flushAsync();
    expect(container.textContent).toBe("");
  });

  it("advertises an upgrade when the latest release tag is newer", async () => {
    server.use(
      http.get("*/api/version", () => HttpResponse.json({ version: "v0.1.0" })),
      http.get(releaseUrl, () =>
        HttpResponse.json({
          tag_name: "v0.2.0",
          html_url: "https://github.com/LeeCheneler/kiri/releases/tag/v0.2.0",
        }),
      ),
    );
    renderFooter();

    const link = await screen.findByRole("link", { name: /update available: v0\.2\.0/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/LeeCheneler/kiri/releases/tag/v0.2.0",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    await flushAsync();
  });

  it("does not advertise an upgrade when the running version equals the latest", async () => {
    server.use(
      http.get("*/api/version", () => HttpResponse.json({ version: "v0.2.0" })),
      http.get(releaseUrl, () =>
        HttpResponse.json({
          tag_name: "v0.2.0",
          html_url: "https://github.com/LeeCheneler/kiri/releases/tag/v0.2.0",
        }),
      ),
    );
    renderFooter();

    await screen.findByText("v0.2.0");
    expect(screen.queryByText(/update available/i)).toBeNull();
    await flushAsync();
  });

  it('suppresses the upgrade nudge on "dev" builds even if a release exists', async () => {
    server.use(
      http.get("*/api/version", () => HttpResponse.json({ version: "dev" })),
      http.get(releaseUrl, () =>
        HttpResponse.json({
          tag_name: "v9.9.9",
          html_url: "https://github.com/LeeCheneler/kiri/releases/tag/v9.9.9",
        }),
      ),
    );
    renderFooter();

    await screen.findByText("dev");
    expect(screen.queryByText(/update available/i)).toBeNull();
    await flushAsync();
  });

  it("still renders the version when the GitHub fetch fails", async () => {
    server.use(
      http.get("*/api/version", () => HttpResponse.json({ version: "v0.1.0" })),
      http.get(releaseUrl, () => new HttpResponse(null, { status: 503 })),
    );
    renderFooter();

    await screen.findByText("v0.1.0");
    expect(screen.queryByText(/update available/i)).toBeNull();
    await flushAsync();
  });
});
