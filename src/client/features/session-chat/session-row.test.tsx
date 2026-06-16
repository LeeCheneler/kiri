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
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  preview: "Summarise the readme",
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

  it("falls back to the short id when no message has been sent", () => {
    renderRow({ id: "abcdef0123", preview: null });
    expect(screen.getByRole("link", { name: "abcdef01" }).getAttribute("href")).toBe(
      "/sessions/abcdef0123",
    );
  });

  it("shows the model without its provider and org prefix", () => {
    renderRow();
    expect(screen.getByText("gemma-4-26b-a4b-qat")).toBeDefined();
    expect(screen.queryByText(/local:google/)).toBeNull();
  });

  it("shows a compact token total once a turn has run", () => {
    renderRow({ totalTokens: 12345 });
    expect(screen.getByText(/12k tok/)).toBeDefined();
  });

  it("omits the token total before any tokens are used", () => {
    renderRow({ totalTokens: 0 });
    expect(screen.queryByText(/tok/)).toBeNull();
  });
});
