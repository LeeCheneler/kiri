import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { Dashboard } from "./dashboard.tsx";

afterEach(() => cleanup());

const renderDashboard = () => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <Dashboard />
    </Router>,
  );
};

describe("<Dashboard>", () => {
  it("renders the activity section heading", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: /activity/i })).toBeDefined();
  });

  it("shows a loading message while runs are being fetched", () => {
    renderDashboard();
    expect(screen.getByText(/loading runs/i)).toBeDefined();
  });

  it("delegates rendering to the activity feed once runs load", async () => {
    renderDashboard();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });

  it("surfaces fetch failures via an alert", async () => {
    server.use(http.get("*/api/runs", () => new HttpResponse("boom", { status: 500 })));
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load runs/i);
  });
});
