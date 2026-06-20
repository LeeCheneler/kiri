import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4242;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = here;
const KIRI_BIN = resolve(here, "bin/kiri.ts");

// The OpenAI-compatible stub the fixture's kiri.yaml points at. Booted
// as its own webServer so sessions and `llm:` steps have a live provider to
// resolve, list models from, and stream turns against. Its port is fixed so the
// checked-in fixture config can reference it.
const FAKE_LLM_PORT = 4243;
const FAKE_LLM = resolve(here, "tests/support/fake-openai-server.ts");

// Reset state and link the SPA bundle into the fixture cwd just before
// booting kiri. Runs as the webServer command (not globalSetup) so the
// wipe completes before kiri opens the SQLite handle — Playwright starts
// the webServer before globalSetup.
const fixtureBoot = [
  "rm -rf .kiri",
  `ln -sfn "${resolve(REPO_ROOT, "dist")}" dist`,
  `bun ${KIRI_BIN}`,
].join(" && ");

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/fixture/**"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    // The stub first, so kiri's model listing has something to resolve against.
    {
      command: `bun ${FAKE_LLM}`,
      env: { FAKE_OPENAI_PORT: String(FAKE_LLM_PORT) },
      url: `http://127.0.0.1:${FAKE_LLM_PORT}/v1/models`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: fixtureBoot,
      cwd: "tests/e2e/fixture",
      url: `${BASE_URL}/api/health`,
      // Always start a fresh kiri pointed at the fixture cwd. A reused dev
      // server would have a different workflow registry and different state.
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
