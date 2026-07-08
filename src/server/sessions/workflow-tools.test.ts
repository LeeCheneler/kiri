import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { createConfigStore } from "../config/store.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { articles, runs } from "../db/schema.ts";
import { type EventBus, type KiriEvent, createEventBus } from "../events/index.ts";
import { createCancelRegistry } from "../runner/cancel-registry.ts";
import {
  type Registry,
  type WorkflowDefinition,
  createRegistry,
  loadWorkflows,
  workflowSchema,
} from "../workflows/index.ts";
import { detectHostEnvironment } from "./host-environment.ts";
import { buildWorkflowAuthoringGuide } from "./workflow-authoring-guide.ts";
import { type WorkflowToolsDeps, workflowTools } from "./workflow-tools.ts";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (
  t: ToolSet[string],
  input: unknown,
  options?: Partial<ToolExecutionOptions>,
): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
    ...options,
  } as ToolExecutionOptions);

const define = (definition: unknown): WorkflowDefinition => workflowSchema.parse(definition);

const seed = (registry: Registry, definitions: WorkflowDefinition[]): void => {
  registry.replace(new Map(definitions.map((definition) => [definition.name, definition])));
};

describe("workflowTools", () => {
  let dir: string;
  let db: KiriDb;
  let registry: Registry;
  let bus: EventBus;
  let events: KiriEvent[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-workflow-tools-"));
    mkdirSync(join(dir, "workflows"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    registry = createRegistry();
    bus = createEventBus();
    events = [];
    bus.subscribe((event) => events.push(event));
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tools = (overrides?: Partial<WorkflowToolsDeps>): ToolSet =>
    workflowTools({ db, registry, config: createConfigStore(dir), bus, ...overrides });

  describe("list_workflows", () => {
    it("lists each workflow's catalog fields and declared inputs", async () => {
      seed(registry, [
        define({
          name: "news",
          description: "Daily news digest",
          group: "News",
          inputs: [
            {
              name: "since",
              description: "Lookback window",
              required: true,
              default: "24h",
              options: ["24h", "7d"],
            },
          ],
          steps: [{ sh: "printf ok" }],
        }),
        define({ name: "mini", steps: [{ sh: "printf ok" }] }),
      ]);

      const output = await run(tools().list_workflows, {});

      expect(output).toEqual([
        {
          name: "news",
          description: "Daily news digest",
          group: "News",
          inputs: [
            {
              name: "since",
              description: "Lookback window",
              required: true,
              default: "24h",
              options: ["24h", "7d"],
            },
          ],
        },
        { name: "mini", description: undefined, group: undefined, inputs: undefined },
      ]);
    });

    it("returns an empty list when no workflows are defined", async () => {
      expect(await run(tools().list_workflows, {})).toEqual([]);
    });
  });

  describe("run_workflow", () => {
    it("rejects an unknown workflow name", () => {
      expect(run(tools().run_workflow, { name: "nope" })).rejects.toThrow(
        'No workflow named "nope" — call list_workflows',
      );
    });

    it("rejects a missing required input", () => {
      seed(registry, [
        define({
          name: "greet",
          inputs: [{ name: "who", required: true }],
          steps: [{ sh: "printf ok" }],
        }),
      ]);
      expect(run(tools().run_workflow, { name: "greet" })).rejects.toThrow(
        'Invalid inputs for workflow "greet": input "who" is required',
      );
    });

    it("rejects an input value outside the declared options", () => {
      seed(registry, [
        define({
          name: "news",
          inputs: [{ name: "since", options: ["24h", "7d"] }],
          steps: [{ sh: "printf ok" }],
        }),
      ]);
      expect(run(tools().run_workflow, { name: "news", inputs: { since: "1y" } })).rejects.toThrow(
        "is not one of the declared options",
      );
    });

    it("runs a workflow to completion and reports the compact outcome", async () => {
      seed(registry, [
        define({
          name: "greet",
          inputs: [{ name: "who", default: "world" }],
          steps: [
            { sh: 'printf "hello $WHO"', name: "Greet", env: { WHO: { input: "who" } } },
            { sh: "cat" },
          ],
          articles: [{ slug: "notes", sh: 'printf "# Notes"' }],
          summarize: { sh: 'printf "all done"' },
        }),
      ]);

      const output = await run(tools().run_workflow, { name: "greet", inputs: { who: "kiri" } });

      expect(output).toEqual({
        run_id: expect.any(String),
        status: "ok",
        error: undefined,
        summary: "all done",
        steps: [
          { name: "Greet", status: "ok", error: undefined },
          { name: "cat", status: "ok", error: undefined },
          { name: "article: notes", status: "ok", error: undefined },
          { name: "summarize", status: "ok", error: undefined },
        ],
        articles: [{ slug: "notes", name: "Notes" }],
      });

      // The run is first-class: it publishes the usual lifecycle events.
      const { run_id } = output as { run_id: string };
      expect(events).toContainEqual({ type: "run.started", id: run_id });
      expect(events).toContainEqual({ type: "run.finished", id: run_id, status: "ok" });
    });

    it("reports a failed run's outcome with the failing step's streams", async () => {
      seed(registry, [
        define({
          name: "broken",
          steps: [{ sh: "printf partial; echo boom >&2; exit 7" }, { sh: "printf never" }],
        }),
      ]);

      const output = (await run(tools().run_workflow, { name: "broken" })) as {
        status: string;
        error?: string;
        steps: { status: string; error?: string; stdout?: string; stderr?: string }[];
      };

      expect(output.status).toBe("failed");
      expect(output.error).toBeString();
      // Fail-fast: the second step never ran, so only the failed row reports.
      expect(output.steps).toHaveLength(1);
      expect(output.steps[0]?.status).toBe("failed");
      expect(output.steps[0]?.error).toBe(output.error as string);
      // The failing step's captured streams ride along so the model can
      // diagnose the failure — the error alone is just the exit code.
      expect(output.steps[0]?.stdout).toBe("partial");
      expect(output.steps[0]?.stderr).toBe("boom\n");
    });

    it("tail-truncates a failed step's streams and omits empty ones", async () => {
      // The stderr payload is one char over what survives the cap, with an
      // emoji placed so its surrogate pair straddles the cut: the kept tail
      // would start with the orphaned low half, which truncation drops.
      seed(registry, [
        define({
          name: "chatty",
          steps: [{ sh: "{ printf 'x😀'; head -c 8191 /dev/zero | tr '\\0' 'y'; } >&2; exit 1" }],
        }),
      ]);

      const output = (await run(tools().run_workflow, { name: "chatty" })) as {
        steps: { stdout?: string; stderr?: string }[];
      };

      expect(output.steps[0]?.stderr).toBe(
        `[truncated — full output on the run page]\n${"y".repeat(8191)}`,
      );
      // Nothing went to stdout, so the field is omitted rather than empty.
      expect(output.steps[0]?.stdout).toBeUndefined();
    });

    it("cancels the run it started when the turn aborts", async () => {
      // `exec 1>&- 2>&-` closes sh's stdout/stderr before sleep is forked, so
      // Bun's pipe readers get EOF immediately. Without this, an orphaned
      // sleep inherits the write ends and hangs the readers until natural
      // completion (only matters on Linux/CI; macOS resolves them sooner).
      seed(registry, [define({ name: "slow", steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }] })]);
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 25 });
      const controller = new AbortController();

      const pending = run(
        tools({ cancelRegistry }).run_workflow,
        { name: "slow" },
        { abortSignal: controller.signal },
      );
      setTimeout(() => controller.abort(), 50);

      const output = (await pending) as { status: string; steps: { status: string }[] };
      expect(output.status).toBe("cancelled");
      expect(output.steps[0]?.status).toBe("cancelled");
    });
  });

  describe("rerun_workflow", () => {
    it("rejects an unknown run id", () => {
      expect(run(tools().rerun_workflow, { run_id: "nope" })).rejects.toThrow(
        'No run with id "nope"',
      );
    });

    it("rejects a run that is still in flight", () => {
      db.insert(runs)
        .values({
          id: "run-live",
          workflowName: "greet",
          status: "running",
          startedAt: new Date(),
          definitionSnapshot: { name: "greet", steps: [{ sh: "printf ok" }] },
        })
        .run();

      expect(run(tools().rerun_workflow, { run_id: "run-live" })).rejects.toThrow(
        'Run "run-live" is still in flight',
      );
    });

    it("rejects a run whose workflow no longer exists", async () => {
      seed(registry, [define({ name: "greet", steps: [{ sh: "printf ok" }] })]);
      const first = (await run(tools().run_workflow, { name: "greet" })) as { run_id: string };

      seed(registry, []);

      expect(run(tools().rerun_workflow, { run_id: first.run_id })).rejects.toThrow(
        'Workflow "greet" no longer exists',
      );
    });

    it("validates inputs against the workflow's current definition", async () => {
      seed(registry, [define({ name: "greet", steps: [{ sh: "printf ok" }] })]);
      const first = (await run(tools().run_workflow, { name: "greet" })) as { run_id: string };

      // Authoring iteration: the workflow now declares a required input.
      seed(registry, [
        define({
          name: "greet",
          inputs: [{ name: "who", required: true }],
          steps: [{ sh: 'printf "hello $WHO"', env: { WHO: { input: "who" } } }],
        }),
      ]);

      expect(run(tools().rerun_workflow, { run_id: first.run_id })).rejects.toThrow(
        'Invalid inputs for workflow "greet": input "who" is required',
      );
    });

    it("re-executes the current definition in place under the same run id", async () => {
      seed(registry, [
        define({
          name: "greet",
          steps: [{ sh: 'printf "v1"', name: "V1" }],
          articles: [{ slug: "v1-notes", sh: 'printf "# V1 Notes"' }],
        }),
      ]);
      const first = (await run(tools().run_workflow, { name: "greet" })) as { run_id: string };

      seed(registry, [
        define({
          name: "greet",
          inputs: [{ name: "who", required: true }],
          steps: [{ sh: 'printf "hello $WHO"', name: "V2", env: { WHO: { input: "who" } } }],
          articles: [{ slug: "v2-notes", sh: 'printf "# V2 Notes"' }],
        }),
      ]);

      const output = await run(tools().rerun_workflow, {
        run_id: first.run_id,
        inputs: { who: "kiri" },
      });

      expect(output).toEqual({
        run_id: first.run_id,
        status: "ok",
        error: undefined,
        summary: null,
        steps: [
          { name: "V2", status: "ok", error: undefined, stdout: undefined, stderr: undefined },
          {
            name: "article: v2-notes",
            status: "ok",
            error: undefined,
            stdout: undefined,
            stderr: undefined,
          },
        ],
        articles: [{ slug: "v2-notes", name: "V2 Notes" }],
      });

      // In place: still exactly one run row, and the previous iteration's
      // article was wiped rather than accumulated alongside the new one.
      expect(db.select().from(runs).all()).toHaveLength(1);
      const articleRows = db.select().from(articles).all();
      expect(articleRows).toHaveLength(1);
      expect(articleRows[0]?.slug).toBe("v2-notes");

      // The rerun is first-class: it publishes its own lifecycle events
      // under the reused id.
      const started = events.filter(
        (event) => event.type === "run.started" && event.id === first.run_id,
      );
      expect(started).toHaveLength(2);
    });

    it("cancels the rerun it started when the turn aborts", async () => {
      const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 25 });
      seed(registry, [define({ name: "slow", steps: [{ sh: "printf ok" }] })]);
      const first = (await run(tools({ cancelRegistry }).run_workflow, { name: "slow" })) as {
        run_id: string;
      };

      // Same stream-closing preamble as run_workflow's cancel test, so an
      // orphaned sleep can't hang the pipe readers on Linux/CI.
      seed(registry, [define({ name: "slow", steps: [{ sh: "exec 1>&- 2>&-; sleep 5" }] })]);
      const controller = new AbortController();

      const pending = run(
        tools({ cancelRegistry }).rerun_workflow,
        { run_id: first.run_id },
        { abortSignal: controller.signal },
      );
      setTimeout(() => controller.abort(), 50);

      const output = (await pending) as { run_id: string; status: string };
      expect(output.run_id).toBe(first.run_id);
      expect(output.status).toBe("cancelled");
    });
  });

  // Authoring fixtures work off real files: write YAML into workflows/, load
  // it through the real loader, and seed the registry with the result —
  // the same definitions-plus-sources state the watcher maintains live.
  const writeWorkflowFile = (filename: string, content: string): string => {
    const path = join(dir, "workflows", filename);
    writeFileSync(path, content);
    return path;
  };

  const syncFromDisk = async (): Promise<void> => {
    const result = await loadWorkflows(createConfigStore(dir));
    registry.replace(result.workflows, result.sources);
  };

  const GREET_YAML = "name: greet\nsteps:\n  - sh: printf ok\n";

  describe("read_workflow_authoring_guide", () => {
    it("returns the authoring reference built for the running machine", async () => {
      expect(await run(tools().read_workflow_authoring_guide, {})).toBe(
        buildWorkflowAuthoringGuide(detectHostEnvironment()),
      );
    });
  });

  describe("read_workflow", () => {
    it("returns the raw YAML and workspace-relative file of an existing workflow", async () => {
      writeWorkflowFile("greet.yaml", GREET_YAML);
      await syncFromDisk();

      const output = await run(tools().read_workflow, { name: "greet" });

      expect(output).toEqual({
        name: "greet",
        file: "workflows/greet.yaml",
        content_yaml: GREET_YAML,
      });
    });

    it("rejects an unknown workflow name", () => {
      expect(run(tools().read_workflow, { name: "nope" })).rejects.toThrow(
        'No workflow named "nope" — call list_workflows',
      );
    });
  });

  describe("create_workflow", () => {
    it("writes the file with a trailing newline and reports name and file", async () => {
      const output = await run(tools().create_workflow, {
        slug: "hello",
        content_yaml: "name: hello\nsteps:\n  - sh: printf hi",
      });

      expect(output).toEqual({ name: "hello", file: "workflows/hello.yaml" });
      expect(readFileSync(join(dir, "workflows", "hello.yaml"), "utf8")).toBe(
        "name: hello\nsteps:\n  - sh: printf hi\n",
      );
      // The created file round-trips through the real loader, so the watcher's
      // next rebuild will pick it up into the catalog.
      const loaded = await loadWorkflows(createConfigStore(dir));
      expect(loaded.workflows.has("hello")).toBe(true);
      expect(loaded.failures).toEqual([]);
    });

    it("rejects invalid YAML without writing anything", async () => {
      expect(
        run(tools().create_workflow, { slug: "broken", content_yaml: "name: [oops" }),
      ).rejects.toThrow("Invalid workflow YAML — nothing was written.");
      expect(existsSync(join(dir, "workflows", "broken.yaml"))).toBe(false);
    });

    it("rejects a schema violation without writing anything", async () => {
      expect(
        run(tools().create_workflow, { slug: "empty", content_yaml: "name: empty\nsteps: []\n" }),
      ).rejects.toThrow("Invalid workflow YAML");
      expect(existsSync(join(dir, "workflows", "empty.yaml"))).toBe(false);
    });

    it("rejects a workflow referencing a missing bundle", () => {
      expect(
        run(tools().create_workflow, {
          slug: "bundled",
          content_yaml: "name: bundled\nsteps:\n  - use: ghost\n",
        }),
      ).rejects.toThrow('"ghost"');
    });

    it("validates llm providers against the live provider names", async () => {
      const content_yaml =
        "name: digest\nsteps:\n  - llm:\n      model: anthropic:claude\n      prompt: hi\n";
      // Without a provider source every llm workflow is unknown-provider.
      expect(run(tools().create_workflow, { slug: "digest", content_yaml })).rejects.toThrow(
        'unknown llm provider "anthropic"',
      );
      // A wrong guess against a configured set names the valid providers.
      expect(
        run(tools({ getProviderNames: () => new Set(["local"]) }).create_workflow, {
          slug: "digest",
          content_yaml,
        }),
      ).rejects.toThrow("configured providers: local");
      const output = await run(
        tools({ getProviderNames: () => new Set(["anthropic"]) }).create_workflow,
        { slug: "digest", content_yaml },
      );
      expect(output).toEqual({ name: "digest", file: "workflows/digest.yaml" });
    });

    it("rejects a workflow name the registry already has", async () => {
      writeWorkflowFile("greet.yaml", GREET_YAML);
      await syncFromDisk();
      expect(
        run(tools().create_workflow, { slug: "other", content_yaml: GREET_YAML }),
      ).rejects.toThrow('A workflow named "greet" already exists');
      expect(existsSync(join(dir, "workflows", "other.yaml"))).toBe(false);
    });

    it("rejects a slug whose .yaml or .yml file already exists", async () => {
      writeWorkflowFile("taken.yaml", GREET_YAML);
      expect(
        run(tools().create_workflow, {
          slug: "taken",
          content_yaml: "name: fresh\nsteps:\n  - sh: printf hi\n",
        }),
      ).rejects.toThrow("workflows/taken.yaml already exists");

      writeWorkflowFile("legacy.yml", "name: legacy\nsteps:\n  - sh: printf ok\n");
      expect(
        run(tools().create_workflow, {
          slug: "legacy",
          content_yaml: "name: fresh\nsteps:\n  - sh: printf hi\n",
        }),
      ).rejects.toThrow("workflows/legacy.yml already exists");
    });
  });

  describe("edit_workflow", () => {
    const seedGreet = async (): Promise<string> => {
      const path = writeWorkflowFile("greet.yaml", GREET_YAML);
      await syncFromDisk();
      return path;
    };

    it("rejects identical old and new strings", () => {
      expect(
        run(tools().edit_workflow, { name: "greet", old_string: "x", new_string: "x" }),
      ).rejects.toThrow("identical — nothing to change");
    });

    it("rejects an unknown workflow name", () => {
      expect(
        run(tools().edit_workflow, { name: "nope", old_string: "a", new_string: "b" }),
      ).rejects.toThrow('No workflow named "nope"');
    });

    it("rejects an old_string absent from the file", async () => {
      await seedGreet();
      expect(
        run(tools().edit_workflow, { name: "greet", old_string: "absent", new_string: "b" }),
      ).rejects.toThrow("old_string was not found");
    });

    it("rejects an ambiguous old_string unless replace_all is set", async () => {
      writeWorkflowFile("two.yaml", "name: two\nsteps:\n  - sh: printf ok\n  - sh: printf ok\n");
      await syncFromDisk();

      expect(
        run(tools().edit_workflow, {
          name: "two",
          old_string: "printf ok",
          new_string: "printf done",
        }),
      ).rejects.toThrow("appears 2 times");

      const output = await run(tools().edit_workflow, {
        name: "two",
        old_string: "printf ok",
        new_string: "printf done",
        replace_all: true,
      });
      expect(output).toEqual({ name: "two", file: "workflows/two.yaml", replacements: 2 });
      expect(readFileSync(join(dir, "workflows", "two.yaml"), "utf8")).toBe(
        "name: two\nsteps:\n  - sh: printf done\n  - sh: printf done\n",
      );
    });

    it("applies a unique edit and writes the validated result", async () => {
      const path = await seedGreet();
      const output = await run(tools().edit_workflow, {
        name: "greet",
        old_string: "printf ok",
        new_string: "printf hello",
      });
      expect(output).toEqual({ name: "greet", file: "workflows/greet.yaml", replacements: 1 });
      expect(readFileSync(path, "utf8")).toBe("name: greet\nsteps:\n  - sh: printf hello\n");
    });

    it("rejects an edit whose result fails validation, leaving the file unchanged", async () => {
      const path = await seedGreet();
      expect(
        run(tools().edit_workflow, { name: "greet", old_string: "steps:", new_string: "stepz:" }),
      ).rejects.toThrow("Invalid workflow YAML — nothing was written.");
      expect(readFileSync(path, "utf8")).toBe(GREET_YAML);
    });

    it("allows a rename to an unused name and rejects a colliding one", async () => {
      writeWorkflowFile("greet.yaml", GREET_YAML);
      writeWorkflowFile("other.yaml", "name: other\nsteps:\n  - sh: printf ok\n");
      await syncFromDisk();

      expect(
        run(tools().edit_workflow, {
          name: "greet",
          old_string: "name: greet",
          new_string: "name: other",
        }),
      ).rejects.toThrow('A workflow named "other" already exists');

      const output = await run(tools().edit_workflow, {
        name: "greet",
        old_string: "name: greet",
        new_string: "name: welcome",
      });
      expect(output).toEqual({ name: "welcome", file: "workflows/greet.yaml", replacements: 1 });
    });
  });

  describe("replace_workflow", () => {
    it("rewrites the file wholesale behind the validation gate", async () => {
      const path = writeWorkflowFile("greet.yaml", GREET_YAML);
      await syncFromDisk();

      const output = await run(tools().replace_workflow, {
        name: "greet",
        content_yaml: "name: greet\ndescription: says hi\nsteps:\n  - sh: printf hi",
      });

      expect(output).toEqual({ name: "greet", file: "workflows/greet.yaml" });
      expect(readFileSync(path, "utf8")).toBe(
        "name: greet\ndescription: says hi\nsteps:\n  - sh: printf hi\n",
      );
    });

    it("rejects invalid content, leaving the file unchanged", async () => {
      const path = writeWorkflowFile("greet.yaml", GREET_YAML);
      await syncFromDisk();
      expect(
        run(tools().replace_workflow, { name: "greet", content_yaml: "steps: []\n" }),
      ).rejects.toThrow("Invalid workflow YAML");
      expect(readFileSync(path, "utf8")).toBe(GREET_YAML);
    });

    it("rejects an unknown workflow name", () => {
      expect(
        run(tools().replace_workflow, { name: "nope", content_yaml: GREET_YAML }),
      ).rejects.toThrow('No workflow named "nope"');
    });

    it("rejects a rewrite renaming onto an existing workflow", async () => {
      writeWorkflowFile("greet.yaml", GREET_YAML);
      writeWorkflowFile("other.yaml", "name: other\nsteps:\n  - sh: printf ok\n");
      await syncFromDisk();
      expect(
        run(tools().replace_workflow, {
          name: "greet",
          content_yaml: "name: other\nsteps:\n  - sh: printf hi\n",
        }),
      ).rejects.toThrow('A workflow named "other" already exists');
    });
  });
});
