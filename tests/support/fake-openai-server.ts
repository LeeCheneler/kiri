/**
 * Standalone entry point for the OpenAI-compatible stub, booted by Playwright as
 * a second `webServer` so the e2e fixture's `llm-providers.yaml` has a live
 * provider to resolve, list models from, and stream turns against. The behaviour
 * lives in `fake-openai.ts`; this file is just the process wrapper.
 */
import { fakeOpenAiFetch } from "./fake-openai.ts";

const port = Number(process.env.FAKE_OPENAI_PORT ?? 4243);
Bun.serve({ port, fetch: fakeOpenAiFetch });
// Playwright waits on the `/v1/models` URL; the log aids local debugging.
console.log(`fake-openai listening on http://127.0.0.1:${port}`);
