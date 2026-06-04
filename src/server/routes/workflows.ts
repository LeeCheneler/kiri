import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { resolvePublishName } from "../../shared/publish-name.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import type { CancelRegistry } from "../runner/cancel-registry.ts";
import { runWorkflow } from "../runner/index.ts";
import { type Registry, type WorkflowDefinition, buildInputSchema } from "../workflows/index.ts";
import { onZodFail, optionalInvokeBody, workflowNameParamSchema, zodErrorBody } from "./shared.ts";

export interface WorkflowsRoutesDeps {
  db: KiriDb;
  registry: Registry;
  cwd: string;
  bus?: EventBus;
  cancelRegistry?: CancelRegistry;
}

const summarizeWorkflow = (def: WorkflowDefinition) => ({
  name: def.name,
  // Absent fields collapse to `undefined`, which `JSON.stringify` drops, so
  // the client sees a missing key (its single "not declared" signal) rather
  // than an empty string.
  description: def.description,
  group: def.group,
  // The invoke modal renders one field per declared input; the field's
  // metadata (description, required, default) lives on each entry.
  // Absent when the workflow declares no `inputs:` block.
  inputs: def.inputs,
  steps: def.steps,
  // Absence (no `publish:` / `summarize:` field, or `publish: []`) collapses
  // to `undefined` so the client has a single "section not present" signal.
  publish:
    def.publish && def.publish.length > 0
      ? def.publish.map((entry) => ({
          ...entry,
          name: resolvePublishName(entry.slug, entry.name),
        }))
      : undefined,
  summarize: def.summarize,
});

/**
 * Build the Hono sub-app for `/api/workflows/*`: the registry listing and
 * the manual invoke endpoint that starts a run. Mounted at `/api/workflows`
 * by `createApp`.
 */
export function workflowsRoutes(deps: WorkflowsRoutesDeps): Hono {
  const { db, registry, cwd, bus, cancelRegistry } = deps;
  const app = new Hono();

  app.get("/", (c) => c.json(registry.listWorkflows().map(summarizeWorkflow)));

  app.post(
    "/:name/runs",
    zValidator("param", workflowNameParamSchema, onZodFail("invalid workflow name")),
    optionalInvokeBody,
    async (c) => {
      const { name } = c.req.valid("param");
      const wf = registry.getWorkflow(name);
      if (!wf) return c.json({ error: `workflow "${name}" not found` }, 404);

      const { inputs = {} } = c.get("invokeBody");
      const check = buildInputSchema(wf).safeParse(inputs);
      if (!check.success) return c.json(zodErrorBody(check.error, "invalid inputs"), 400);

      const { runId, done } = runWorkflow(db, wf, {
        cwd,
        bus,
        cancelRegistry,
        inputs,
      });
      // Background execution: log unhandled rejections so they don't trip the
      // process-wide handler. The run row is finalised inside `done` before any
      // re-throw, so the DB stays consistent regardless.
      done.catch((cause) => {
        console.error(`run ${runId} crashed: ${cause instanceof Error ? cause.message : cause}`);
      });
      return c.json({ runId, status: "running" }, 202);
    },
  );

  return app;
}
