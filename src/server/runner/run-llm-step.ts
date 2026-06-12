import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type LlmClients, renderPrompt } from "../llm/index.ts";
import type { LlmStep } from "../workflows/index.ts";
import type { ChildHandle } from "./cancel-registry.ts";
import type { StepEnvelope } from "./run-step.ts";

export interface RunLlmStepArgs {
  /** The validated `llm:` step to execute. */
  step: LlmStep;
  /** Repo root. `prompt_file` paths resolve against it. */
  cwd: string;
  /** Bytes the previous step piped downstream. Exposed to the prompt as `{{KIRI_INPUT}}`. */
  input: string;
  /**
   * Scoped env vars, exactly as `runStep` receives them. An llm step spawns
   * nothing, so the map is consumed purely as the prompt's template vars —
   * the same names a bundle's renderer would read from its environment.
   */
  env: Record<string, string>;
  /** Completion client. Absent (server wired without llm support) ⇒ the step fails cleanly. */
  llmClients?: LlmClients;
  /**
   * Receives the cancel handle before the model call starts. `kill()` aborts
   * the in-flight call regardless of the signal passed — there is no process
   * to graduate from SIGTERM to SIGKILL.
   */
  onSpawn?: (handle: ChildHandle) => void;
}

/**
 * Execute an `llm:` step: render its prompt template and run a single
 * completion, mapping the result onto the standard envelope. The completion
 * text becomes both `output` and `traces.stdout` (`stderr` stays empty —
 * there is no second stream), and token counts land on `traces.usage`.
 * Any failure — unreadable `prompt_file`, resolution error, provider/API
 * error, abort — yields `status: "failed"` with the cause's message.
 */
export async function runLlmStep(args: RunLlmStepArgs): Promise<StepEnvelope> {
  const { step, cwd, input, env, llmClients, onSpawn } = args;
  const startedAt = performance.now();
  const fail = (error: { message: string; stack?: string }): StepEnvelope => ({
    status: "failed",
    output: "",
    error,
    traces: { stdout: "", stderr: "", durationMs: performance.now() - startedAt },
  });

  if (!llmClients) {
    return fail({
      message: `llm steps are not configured on this server (model "${step.llm.model}")`,
    });
  }

  let template: string;
  if (step.llm.prompt !== undefined) {
    template = step.llm.prompt;
  } else if (step.llm.prompt_file !== undefined) {
    // Validated to exist at workflow load, but read at run time — the file
    // can have been deleted since.
    try {
      template = readFileSync(join(cwd, step.llm.prompt_file), "utf8");
    } catch (cause) {
      return fail({
        message: `failed to read prompt_file "${step.llm.prompt_file}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
  } else {
    // steps:/publish: schemas require a prompt source and the runner
    // substitutes the default summary prompt before a summarize step gets
    // here, so this is an invariant breach, not a user error.
    return fail({
      message: `llm step declares neither prompt nor prompt_file (model "${step.llm.model}")`,
    });
  }

  // One trailing newline trimmed, matching the bundles' `KIRI_INPUT="$(cat)"`.
  const kiriInput = input.endsWith("\n") ? input.slice(0, -1) : input;
  const prompt = renderPrompt(template, { ...env, KIRI_INPUT: kiriInput });

  // The cancel registry treats the abort handle like any child process:
  // publish it before the call so a cancel requested mid-flight (or already
  // pending) aborts the request.
  const controller = new AbortController();
  onSpawn?.({ kill: () => controller.abort() });

  try {
    const { text, usage } = await llmClients.generateText({
      model: step.llm.model,
      prompt,
      abortSignal: controller.signal,
    });
    return {
      status: "ok",
      output: text,
      traces: { stdout: text, stderr: "", durationMs: performance.now() - startedAt, usage },
    };
  } catch (cause) {
    return cause instanceof Error
      ? fail({ message: cause.message, stack: cause.stack })
      : fail({ message: String(cause) });
  }
}
