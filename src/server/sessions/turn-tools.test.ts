import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelMessage, type ToolSet, tool } from "ai";
import { z } from "zod";
import { describedModel } from "../../../tests/support/described-model.ts";
import type { ModelsConfig } from "../config/schema.ts";
import type { ConfigService, ConfigSnapshot } from "../config/service.ts";
import { createConfigStore } from "../config/store.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { LlmClients } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/registry.ts";
import { createProject } from "../projects/store.ts";
import { createRegistry } from "../workflows/index.ts";
import type { CommandJudgementEvent } from "./command-judgement-log.ts";
import type { CommandLearning } from "./command-learning.ts";
import { createSession } from "./store.ts";
import { type ToolPermission, createToolPermissionStore } from "./tool-permissions.ts";
import { createTurnTools } from "./turn-tools.ts";

const MODEL = "test:model";
const UTILITY: ModelsConfig = { shortcuts: {}, delegates: {}, utility: "test:utility" };

describe("turn tools", () => {
  let root: string;
  let db: KiriDb;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "kiri-turn-tools-")));
    db = openDatabase(join(root, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(root, { recursive: true, force: true });
  });

  const snapshotWith = (
    options: { sandbox?: boolean; models?: ModelsConfig } = {},
  ): ConfigSnapshot => ({
    revision: 1,
    providers: new Map(),
    mcp: new Map(),
    models: options.models ?? { shortcuts: {}, delegates: {} },
    filesystem: { allowedDirectories: options.sandbox ? [root] : [] },
    diagnostics: { mcpUnresolved: [] },
  });

  // The assembly over a fixed snapshot, with the judge and the learning loop
  // recorded rather than run.
  const assemble = (
    options: {
      snapshot?: ConfigSnapshot;
      permissions?: Record<string, ToolPermission>;
      mcpTools?: ToolSet;
      judgeReply?: string;
    } = {},
  ) => {
    const snapshot = options.snapshot ?? snapshotWith();
    const configService: ConfigService = { current: () => snapshot, reload: () => snapshot };
    const config = createConfigStore(root);
    const toolPermissions = createToolPermissionStore(config.toolPermissionsFile());
    for (const [name, permission] of Object.entries(options.permissions ?? {})) {
      toolPermissions.set(name, permission);
    }
    const judgeCalls: string[] = [];
    const llmClients: LlmClients = {
      resolveModel: () => {
        throw new Error("unused");
      },
      resolveImageModel: () => {
        throw new Error("unused");
      },
      resolveTranscriptionModel: () => {
        throw new Error("unused");
      },
      generateText: async ({ model }) => {
        judgeCalls.push(model);
        return { text: options.judgeReply ?? "", usage: {} };
      },
      listModels: async () => ({ models: [], failures: [] }),
      describeModel: async (id) => describedModel(id),
    };
    const judgements: Omit<CommandJudgementEvent, "type" | "at">[] = [];
    const commandLearning: CommandLearning = {
      recordJudgement: (event) => {
        judgements.push(event);
      },
      recordResolution: () => {},
      guidance: () => "",
      flush: async () => {},
    };
    const turnTools = createTurnTools({
      db,
      config,
      configService,
      registry: createRegistry(),
      llmClients,
      ...(options.mcpTools
        ? { mcpRegistry: { tools: () => options.mcpTools } as unknown as McpRegistry }
        : {}),
      toolPermissions,
      commandLearning,
      startTurn: () => {
        throw new Error("no turn starts in this test");
      },
    });
    return {
      tools: (sessionId: string) => turnTools.activeTools(sessionId, snapshot),
      judgeCalls,
      judgements,
    };
  };

  // Ask a gated tool whether this call pauses, as the SDK does before running it.
  const needsApproval = async (
    gated: ToolSet[string] | undefined,
    input: unknown,
    messages: ModelMessage[] = [],
  ): Promise<boolean> => {
    const check = gated?.needsApproval;
    if (typeof check !== "function") throw new Error("tool is not gated");
    return check(input, { toolCallId: "call_1", messages });
  };

  const echo = tool({ inputSchema: z.object({}), execute: async () => "ok" });

  describe("standing permissions", () => {
    it("withholds an off tool, asks for an ask tool, and runs an allow tool", async () => {
      createSession(db, MODEL, { id: "s1" });
      const { tools } = assemble({
        mcpTools: { srv__off: echo, srv__ask: echo, srv__allow: echo },
        permissions: { srv__off: "off", srv__ask: "ask", srv__allow: "allow" },
      });

      const offered = tools("s1");

      expect(offered.srv__off).toBeUndefined();
      expect(await needsApproval(offered.srv__ask, {})).toBe(true);
      expect(await needsApproval(offered.srv__allow, {})).toBe(false);
    });

    it("asks for an MCP tool with no recorded permission, and honours a built-in's default", async () => {
      createSession(db, MODEL, { id: "s1" });
      const offered = assemble({ mcpTools: { srv__new: echo } }).tools("s1");

      expect(await needsApproval(offered.srv__new, {})).toBe(true);
      expect(await needsApproval(offered.list_workflows, {})).toBe(false);
      expect(await needsApproval(offered.run_workflow, {})).toBe(true);
    });

    it("still reports an allowed call as needing approval once the user has answered it", async () => {
      createSession(db, MODEL, { id: "s1" });
      const offered = assemble({
        mcpTools: { srv__allow: echo },
        permissions: { srv__allow: "allow" },
      }).tools("s1");
      // The SDK re-checks on resume and cancels a call that no longer needs
      // approval — so an answered request must keep reporting true.
      const answered: ModelMessage[] = [
        {
          role: "assistant",
          content: [{ type: "tool-approval-request", approvalId: "a1", toolCallId: "call_1" }],
        },
      ];

      expect(await needsApproval(offered.srv__allow, {}, answered)).toBe(true);
    });

    it("treats auto as ask on any tool but run_command", async () => {
      createSession(db, MODEL, { id: "s1" });
      const { tools, judgeCalls } = assemble({
        snapshot: snapshotWith({ models: UTILITY }),
        mcpTools: { srv__auto: echo },
        permissions: { srv__auto: "auto" },
      });

      expect(await needsApproval(tools("s1").srv__auto, {})).toBe(true);
      expect(judgeCalls).toEqual([]);
    });

    it("lets a built-in take the name on a collision with an MCP tool", () => {
      createSession(db, MODEL, { id: "s1" });
      const offered = assemble({ mcpTools: { list_workflows: echo } }).tools("s1");

      expect(offered.list_workflows?.execute).not.toBe(echo.execute);
    });
  });

  describe("run_command auto permission", () => {
    const auto = (judgeReply?: string, models: ModelsConfig = UTILITY) => {
      createSession(db, MODEL, { id: "s1" });
      return assemble({
        snapshot: snapshotWith({ sandbox: true, models }),
        permissions: { run_command: "auto" },
        judgeReply,
      });
    };

    it("runs a screen-allowed command without consulting the judge", async () => {
      const { tools, judgeCalls, judgements } = auto();

      expect(await needsApproval(tools("s1").run_command, { command: "pwd" })).toBe(false);
      expect(judgeCalls).toEqual([]);
      expect(judgements).toMatchObject([
        { toolCallId: "call_1", command: "pwd", cwd: root, verdict: "allow", source: "screen" },
      ]);
    });

    it("pauses a screen-triggered command without consulting the judge", async () => {
      const { tools, judgeCalls, judgements } = auto();

      expect(await needsApproval(tools("s1").run_command, { command: "rm -rf build" })).toBe(true);
      expect(judgeCalls).toEqual([]);
      expect(judgements).toMatchObject([{ verdict: "ask", source: "screen" }]);
    });

    it("defers everything else to the utility model's judgement", async () => {
      const { tools, judgeCalls, judgements } = auto(
        "EFFECTS: prints text\nVERDICT: allow\nREASON: harmless echo",
      );

      expect(
        await needsApproval(tools("s1").run_command, { command: "echo judged", cwd: "/work" }),
      ).toBe(false);
      expect(judgeCalls).toEqual(["test:utility"]);
      expect(judgements).toMatchObject([
        { command: "echo judged", cwd: "/work", verdict: "allow", source: "judge" },
      ]);
    });

    it("degrades to ask wholesale, screen included, with no utility model configured", async () => {
      const { tools, judgeCalls, judgements } = auto(undefined, { shortcuts: {}, delegates: {} });

      expect(await needsApproval(tools("s1").run_command, { command: "pwd" })).toBe(true);
      expect(judgeCalls).toEqual([]);
      expect(judgements).toEqual([]);
    });
  });

  describe("catalogue", () => {
    it("withholds the filesystem and shell tools until a sandbox is declared", () => {
      createSession(db, MODEL, { id: "s1" });

      expect(assemble().tools("s1").run_command).toBeUndefined();
      expect(assemble().tools("s1").read_file).toBeUndefined();
      const sandboxed = assemble({ snapshot: snapshotWith({ sandbox: true }) }).tools("s1");
      expect(sandboxed.run_command).toBeDefined();
      expect(sandboxed.read_file).toBeDefined();
    });

    it("offers generate_image only while the session has an image model", () => {
      createSession(db, MODEL, { id: "plain" });
      createSession(db, MODEL, { id: "painter", imageModel: "test:paint" });
      const { tools } = assemble();

      expect(tools("plain").generate_image).toBeUndefined();
      expect(tools("painter").generate_image).toBeDefined();
    });

    it("gives a top-level session the delegation tools and a worker only message_parent", () => {
      // In a project, so the project-scoped tools are part of the catalogue.
      createProject(db, "Project", { id: "p1" });
      createSession(db, MODEL, { id: "parent", projectId: "p1" });
      createSession(db, MODEL, {
        id: "worker",
        projectId: "p1",
        parentSessionId: "parent",
        parentToolCallId: "call_1",
      });
      const { tools } = assemble();

      const parent = Object.keys(tools("parent"));
      const worker = Object.keys(tools("worker"));

      expect(parent).toContain("delegate");
      expect(parent).toContain("message_worker");
      expect(parent).not.toContain("message_parent");
      expect(worker).toContain("message_parent");
      // A worker can't spawn or steer workers, and leaves the durable record —
      // articles, memories, project instructions, tasks — to the conversation.
      expect(parent.filter((name) => !worker.includes(name)).sort()).toEqual([
        "add_task",
        "create_article",
        "create_task_group",
        "delegate",
        "delete_article",
        "delete_memory",
        "delete_task",
        "delete_task_group",
        "edit_article",
        "message_worker",
        "replace_article",
        "save_memory",
        "update_project_instructions",
        "update_task",
        "update_task_group",
      ]);
    });
  });
});
