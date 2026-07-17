import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionListEntry } from "../../api.ts";
import { SessionRow } from "./session-row.tsx";

const NOW = new Date("2026-05-09T12:03:00.000Z");

const base: SessionListEntry = {
  id: "abc1234567",
  status: "idle",
  model: "local:google/gemma-4-26b-a4b-qat",
  imageModel: null,
  persona: null,
  pinned: false,
  parentSessionId: null,
  parentToolCallId: null,
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
  preview: "Summarise the readme",
  articles: [],
};

const renderRow = (over: Partial<SessionListEntry> = {}) =>
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <SessionRow session={{ ...base, ...over }} now={NOW} />
    </Router>,
  );

describe("<SessionRow>", () => {
  it("links the first message through to the session", () => {
    renderRow();
    expect(screen.getByRole("link", { name: /summarise the readme/i }).getAttribute("href")).toBe(
      "/sessions/abc1234567",
    );
  });

  it("leads the byline with the session kind marker", () => {
    renderRow();
    expect(screen.getByText("session")).toBeDefined();
  });

  it("sets the first message as quoted speech", () => {
    const { container } = renderRow();
    // The quotation marks are decorative (aria-hidden) so the link's accessible
    // name stays the message text alone; the message itself is italicised.
    expect(screen.getByText("“").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("”").getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".italic")?.textContent).toBe("Summarise the readme");
  });

  it("falls back to the short id, unquoted, when no message has been sent", () => {
    const { container } = renderRow({ id: "abcdef0123", preview: null });
    expect(screen.getByRole("link", { name: "abcdef01" }).getAttribute("href")).toBe(
      "/sessions/abcdef0123",
    );
    expect(screen.queryByText("“")).toBeNull();
    expect(container.querySelector(".italic")).toBeNull();
  });

  it("shows the model without its provider and org prefix", () => {
    renderRow();
    expect(screen.getByText("gemma-4-26b-a4b-qat")).toBeDefined();
    expect(screen.queryByText(/local:google/)).toBeNull();
  });

  it("shows the attached persona in the byline", () => {
    renderRow({ persona: "red-team" });
    expect(screen.getByText("red-team")).toBeDefined();
  });

  it("omits the persona entry when none is attached", () => {
    renderRow();
    expect(screen.queryByText("red-team")).toBeNull();
  });

  it("lists the session's articles as links, read by heading with name fallback", () => {
    renderRow({
      articles: [
        { slug: "digest", name: "Notes", heading: "Morning Digest", createdAt: NOW.toISOString() },
        { slug: "scratch", name: "Scratch", heading: null, createdAt: NOW.toISOString() },
      ],
    });

    expect(screen.getByRole("link", { name: "Morning Digest" }).getAttribute("href")).toBe(
      "/sessions/abc1234567/articles/digest",
    );
    // A heading-less article falls back to its name.
    expect(screen.getByRole("link", { name: "Scratch" }).getAttribute("href")).toBe(
      "/sessions/abc1234567/articles/scratch",
    );
  });
});
