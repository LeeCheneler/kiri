import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateLlmTextResult, LlmClients } from "../llm/index.ts";
import type { ChildHandle } from "./cancel-registry.ts";
import { runLlmStep } from "./run-llm-step.ts";

describe("runLlmStep", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-llm-step-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const result: GenerateLlmTextResult = {
    text: "completion text",
    usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
  };

  /** Stub client recording the options `generateText` was called with. */
  const recordingClients = (): LlmClients & {
    calls: { model: string; prompt: string; abortSignal?: AbortSignal }[];
  } => {
    const calls: { model: string; prompt: string; abortSignal?: AbortSignal }[] = [];
    return {
      calls,
      resolveModel: () => {
        throw new Error("resolveModel is not part of the runner contract");
      },
      generateText: async (options) => {
        calls.push(options);
        return result;
      },
      listModels: async () => ({ models: [], failures: [] }),
    };
  };

  it("maps a completion onto the standard envelope with usage on traces", async () => {
    const clients = recordingClients();

    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:claude-haiku-4-5", prompt: "Summarise." } },
      cwd,
      input: "",
      env: {},
      llmClients: clients,
    });

    expect(envelope.status).toBe("ok");
    expect(envelope.output).toBe("completion text");
    expect(envelope.traces.stdout).toBe("completion text");
    expect(envelope.traces.stderr).toBe("");
    expect(envelope.traces.durationMs).toBeGreaterThanOrEqual(0);
    expect(envelope.traces.usage).toEqual({ inputTokens: 11, outputTokens: 22, totalTokens: 33 });
    expect(clients.calls[0]?.model).toBe("anthropic:claude-haiku-4-5");
  });

  it("renders {{VAR}} placeholders from env and exposes input as {{KIRI_INPUT}}", async () => {
    const clients = recordingClients();

    await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt: "{{TONE}} take on: {{KIRI_INPUT}}" } },
      cwd,
      input: "previous stdout\n",
      env: { TONE: "cheery" },
      llmClients: clients,
    });

    // Exactly one trailing newline trimmed, matching the bundles' $(cat).
    expect(clients.calls[0]?.prompt).toBe("cheery take on: previous stdout");
  });

  it("trims only one trailing newline from the input", async () => {
    const clients = recordingClients();

    await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt: "{{KIRI_INPUT}}" } },
      cwd,
      input: "lines\n\n",
      env: {},
      llmClients: clients,
    });

    expect(clients.calls[0]?.prompt).toBe("lines\n");
  });

  it("reads prompt_file against the repo root", async () => {
    mkdirSync(join(cwd, "prompts"));
    writeFileSync(join(cwd, "prompts", "greet.tpl"), "Hello {{NAME}}");
    const clients = recordingClients();

    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt_file: "prompts/greet.tpl" } },
      cwd,
      input: "",
      env: { NAME: "kiri" },
      llmClients: clients,
    });

    expect(envelope.status).toBe("ok");
    expect(clients.calls[0]?.prompt).toBe("Hello kiri");
  });

  it("fails cleanly when prompt_file has gone missing since load", async () => {
    const clients = recordingClients();

    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt_file: "prompts/gone.tpl" } },
      cwd,
      input: "",
      env: {},
      llmClients: clients,
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.error?.message).toContain("prompts/gone.tpl");
    expect(clients.calls).toHaveLength(0);
  });

  it("maps a rejected call onto a failed envelope with the provider message", async () => {
    const clients: LlmClients = {
      resolveModel: () => {
        throw new Error("unused");
      },
      generateText: async () => {
        throw new Error("401 invalid x-api-key");
      },
      listModels: async () => ({ models: [], failures: [] }),
    };

    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt: "p" } },
      cwd,
      input: "",
      env: {},
      llmClients: clients,
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.output).toBe("");
    expect(envelope.error?.message).toBe("401 invalid x-api-key");
    expect(envelope.traces.usage).toBeUndefined();
  });

  it("maps a non-Error rejection onto a failed envelope via String()", async () => {
    const clients: LlmClients = {
      resolveModel: () => {
        throw new Error("unused");
      },
      generateText: () => Promise.reject("socket hang up"),
      listModels: async () => ({ models: [], failures: [] }),
    };

    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt: "p" } },
      cwd,
      input: "",
      env: {},
      llmClients: clients,
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.error?.message).toBe("socket hang up");
    expect(envelope.error?.stack).toBeUndefined();
  });

  it("publishes an abort handle whose kill() cancels the in-flight call", async () => {
    const clients: LlmClients = {
      resolveModel: () => {
        throw new Error("unused");
      },
      generateText: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => reject(new Error("call aborted")));
        }),
      listModels: async () => ({ models: [], failures: [] }),
    };

    let handle: ChildHandle | undefined;
    const pending = runLlmStep({
      step: { llm: { model: "anthropic:m", prompt: "p" } },
      cwd,
      input: "",
      env: {},
      llmClients: clients,
      onSpawn: (h) => {
        handle = h;
      },
    });

    // onSpawn runs synchronously before the model call is awaited, the same
    // ordering the spawn path guarantees.
    expect(handle).toBeDefined();
    handle?.kill("SIGTERM");

    const envelope = await pending;
    expect(envelope.status).toBe("failed");
    expect(envelope.error?.message).toBe("call aborted");
  });

  it("fails cleanly when no llm clients are configured", async () => {
    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:m", prompt: "p" } },
      cwd,
      input: "",
      env: {},
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.error?.message).toContain("not configured");
  });

  it("fails cleanly when a step declares no prompt source", async () => {
    const clients = recordingClients();

    const envelope = await runLlmStep({
      step: { llm: { model: "anthropic:m" } },
      cwd,
      input: "",
      env: {},
      llmClients: clients,
    });

    expect(envelope.status).toBe("failed");
    expect(envelope.error?.message).toContain("neither prompt nor prompt_file");
    expect(clients.calls).toHaveLength(0);
  });
});
