import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { bootstrap } from "../../src/server/bootstrap.ts";
import { loadKiriConfig } from "../../src/server/config/loader.ts";
import { createConfigStore } from "../../src/server/config/store.ts";
import type { KiriDb } from "../../src/server/db/index.ts";
import { runSteps } from "../../src/server/db/schema.ts";
import {
  type LlmClients,
  createLlmClients,
  createLlmProviderRegistry,
} from "../../src/server/llm/index.ts";
import { runWorkflow } from "../../src/server/runner/run-workflow.ts";
import { loadWorkflows } from "../../src/server/workflows/index.ts";
import { type FakeOpenAi, startFakeOpenAi } from "../support/fake-openai.ts";

/**
 * Integration coverage for `llm:` steps over the *real* LLM client stack: YAML
 * on disk → loader → `runWorkflow` → `createLlmClients` → an OpenAI-compatible
 * HTTP endpoint → DB. The unit tests stub `generateText`, so this is the only
 * layer that exercises the AI SDK wiring (request shape, completion + usage
 * parsing) against an actual server.
 */
describe("llm step pipeline", () => {
  let fake: FakeOpenAi;
  let cwd: string;
  let db: KiriDb;
  let llmClients: LlmClients;
  let providerNames: Set<string>;

  beforeAll(() => {
    fake = startFakeOpenAi();
  });

  afterAll(() => {
    fake.stop();
  });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-int-llm-"));
    db = bootstrap(createConfigStore(cwd));
    mkdirSync(join(cwd, "workflows"), { recursive: true });
    writeFileSync(
      join(cwd, "kiri.yaml"),
      `providers:\n  fake:\n    type: openai-compatible\n    base_url: ${fake.url}\n`,
    );
    const loaded = loadKiriConfig(createConfigStore(cwd), process.env);
    expect(loaded.failure).toBeUndefined();
    const registry = createLlmProviderRegistry();
    registry.replace(loaded.providers);
    llmClients = createLlmClients(registry, process.env);
    // The workflow loader checks `llm:` provider prefixes against the declared
    // providers, exactly as the boot path does.
    providerNames = new Set(loaded.providers.keys());
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const writeWorkflow = (name: string, body: string): void => {
    writeFileSync(join(cwd, "workflows", `${name}.yaml`), body);
  };

  const loadAndRun = async (name: string) => {
    const result = await loadWorkflows(createConfigStore(cwd), providerNames);
    expect(result.failures).toEqual([]);
    const def = result.workflows.get(name);
    if (!def) throw new Error(`workflow not found: ${name}`);
    return runWorkflow(db, def, { config: createConfigStore(cwd), llmClients }).done;
  };

  const onlyStep = (runId: string) =>
    db.select().from(runSteps).where(eq(runSteps.runId, runId)).get();

  it("runs a completion, capturing the model's text as output and token usage on the trace", async () => {
    writeWorkflow(
      "ask",
      'name: ask\nsteps:\n  - llm:\n      model: fake:echo\n      prompt: "Greet Lee"\n',
    );

    const result = await loadAndRun("ask");

    expect(result.status).toBe("ok");
    const step = onlyStep(result.runId);
    expect(step?.status).toBe("ok");
    expect(step?.kind).toBe("llm");
    // The stub echoes the rendered prompt back, so the completion proves the
    // prompt reached the provider and its text became the step output.
    expect(step?.output).toBe("You said: Greet Lee");
    expect(step?.traces).toMatchObject({
      stdout: "You said: Greet Lee",
      stderr: "",
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    });
  });

  it("renders an earlier step's stdout into the prompt via a { step } ref", async () => {
    writeWorkflow(
      "refs",
      'name: refs\nsteps:\n  - sh: printf "from upstream"\n    id: upstream\n  - llm:\n      model: fake:echo\n      prompt: "Echo: {{UPSTREAM}}"\n    env:\n      UPSTREAM: { step: upstream }\n',
    );

    const result = await loadAndRun("refs");

    expect(result.status).toBe("ok");
    const steps = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all();
    expect(steps).toHaveLength(2);
    expect(steps[1].output).toBe("You said: Echo: from upstream");
  });

  it("fails the step (and the run) when the provider returns an error", async () => {
    writeWorkflow(
      "boom",
      'name: boom\nsteps:\n  - llm:\n      model: fake:boom\n      prompt: "anything"\n',
    );

    const result = await loadAndRun("boom");

    expect(result.status).toBe("failed");
    const step = onlyStep(result.runId);
    expect(step?.status).toBe("failed");
    expect(step?.output).toBe("");
    // The provider error surfaces as the step error rather than a thrown run.
    expect(step?.error).toMatchObject({ message: expect.any(String) });
  });

  it("rejects a workflow whose llm step names a provider absent from kiri.yaml", async () => {
    writeWorkflow(
      "ghost",
      'name: ghost\nsteps:\n  - llm:\n      model: ghost:model\n      prompt: "hi"\n',
    );

    // An undeclared provider is caught at load (against the names from the real
    // kiri.yaml), the same gate as a missing bundle — it never reaches a run.
    const result = await loadWorkflows(createConfigStore(cwd), providerNames);
    expect(result.workflows.has("ghost")).toBe(false);
    const failure = result.failures.find((f) => f.path.endsWith("ghost.yaml"));
    expect(failure?.reason).toContain('unknown llm provider "ghost"');
  });
});
