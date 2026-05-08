import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { runNodes, runs } from "../db/schema.ts";
import type { WorkflowDefinition, WorkflowNode } from "../workflows/index.ts";
import { runScriptNode } from "./run-script-node.ts";

export interface RunWorkflowArgs {
  /** Repo root. Script paths in the definition resolve relative to this; the scratch dir lives at `<cwd>/.kiri/runs/<run-id>/`. */
  cwd: string;
  /** Where the run was triggered from — recorded on the `runs` row. Currently `"manual"`; cron and MCP triggers will use distinct values. */
  trigger: string;
}

export interface RunWorkflowResult {
  runId: string;
  status: "ok" | "failed";
}

/** Persisted on the `runs` row. Shallow-cloned so the in-memory registry entry can mutate without affecting historical rows. */
interface DefinitionSnapshot {
  name: string;
  nodes: WorkflowNode[];
  gating?: "auto" | "propose";
  schedule?: string;
}

const snapshotDefinition = (def: WorkflowDefinition): DefinitionSnapshot => ({
  name: def.name,
  nodes: def.nodes.map((n) => ({ ...n })),
  gating: def.gating,
  schedule: def.schedule,
});

const scopedEnv = (runId: string, nodeIndex: number): Record<string, string> => ({
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  // USER/LOGNAME are POSIX user-identity vars; tools that authenticate as
  // the user (macOS Keychain lookups, ssh-agent, gpg) rely on them to
  // resolve the active user's session — same category as HOME, not
  // orchestrator state.
  USER: process.env.USER ?? "",
  LOGNAME: process.env.LOGNAME ?? "",
  KIRI_RUN_ID: runId,
  KIRI_NODE_INDEX: String(nodeIndex),
});

/**
 * Execute a workflow definition's linear node list.
 *
 * Lifecycle, in order: insert `runs` with the definition snapshot →
 * create the per-run scratch dir → for each node, read the script source
 * off disk and insert `run_nodes` with `materials` *before* spawning →
 * execute the node → update the row with the envelope → halt on first
 * failure → finalize the `runs` row → remove the scratch dir.
 *
 * Snapshot rows always reflect the bytes that ran, even if the script
 * file is later edited or deleted. Halt-on-failure: a failed node leaves
 * later nodes uncreated, and the run is marked failed.
 */
export async function runWorkflow(
  db: KiriDb,
  definition: WorkflowDefinition,
  args: RunWorkflowArgs,
): Promise<RunWorkflowResult> {
  const runId = crypto.randomUUID();
  const scratchDir = join(args.cwd, ".kiri", "runs", runId);

  db.insert(runs)
    .values({
      id: runId,
      workflowName: definition.name,
      status: "running",
      trigger: args.trigger,
      startedAt: new Date(),
      definitionSnapshot: snapshotDefinition(definition),
    })
    .run();

  let status: "ok" | "failed" = "ok";
  let runError: { message: string; stack?: string } | undefined;
  let caughtThrow: unknown;

  try {
    mkdirSync(scratchDir, { recursive: true });
    let input = "";
    for (let i = 0; i < definition.nodes.length; i++) {
      const node = definition.nodes[i];
      const scriptPath = resolve(args.cwd, node.path);
      let source = "";
      try {
        source = readFileSync(scriptPath, "utf8");
      } catch {
        // Fall through — the spawn will fail with the same root cause and
        // surface it through the envelope. Materials still records what we
        // saw on disk (nothing).
      }

      const nodeId = crypto.randomUUID();
      db.insert(runNodes)
        .values({
          id: nodeId,
          runId,
          index: i,
          kind: "script",
          status: "running",
          materials: { source },
        })
        .run();

      const envelope = await runScriptNode({
        scriptPath,
        scratchDir,
        input,
        env: scopedEnv(runId, i),
      });

      db.update(runNodes)
        .set({
          status: envelope.status,
          output: envelope.output,
          error: envelope.error ?? null,
          traces: envelope.traces,
        })
        .where(eq(runNodes.id, nodeId))
        .run();

      if (envelope.status === "failed") {
        status = "failed";
        // runScriptNode always populates error on a failed envelope.
        runError = envelope.error;
        break;
      }
      input = envelope.output;
    }
  } catch (cause) {
    // mkdirSync, drizzle, or any future surface that throws lands here.
    // Finalize state below before re-throwing so the runs row is never
    // stranded in "running".
    caughtThrow = cause;
    status = "failed";
    runError =
      cause instanceof Error
        ? { message: cause.message, stack: cause.stack }
        : { message: String(cause) };
  }

  db.update(runs)
    .set({ status, finishedAt: new Date(), error: runError ?? null })
    .where(eq(runs.id, runId))
    .run();
  rmSync(scratchDir, { recursive: true, force: true });

  if (caughtThrow !== undefined) throw caughtThrow;
  return { runId, status };
}
