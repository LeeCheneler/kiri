import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessageStreamWriter } from "ai";
import { describedModel } from "../../../tests/support/described-model.ts";
import type { ConfigService, ConfigSnapshot } from "../config/service.ts";
import { createConfigStore } from "../config/store.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createEventBus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import { createRegistry } from "../workflows/index.ts";
import { createSession, getSession, updateSessionCwd } from "./store.ts";
import { createToolPermissionStore } from "./tool-permissions.ts";
import { createTurnPreparation } from "./turn-preparation.ts";
import { createTurnTools } from "./turn-tools.ts";
import type { PreparedTurn } from "./turn.ts";

const MODEL = "test:model";

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
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: [], failures: [] }),
  describeModel: async (id) => describedModel(id),
};

describe("turn preparation", () => {
  let root: string;
  let db: KiriDb;
  let snapshot: ConfigSnapshot;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "kiri-turn-preparation-")));
    db = openDatabase(join(root, "state.db"));
    migrate(db);
    snapshot = {
      revision: 1,
      providers: new Map(),
      mcp: new Map(),
      models: { shortcuts: {}, delegates: {} },
      filesystem: { allowedDirectories: [root], defaultWorkingDirectory: root },
      diagnostics: { mcpUnresolved: [] },
    };
  });

  afterEach(() => {
    db.$client.close();
    rmSync(root, { recursive: true, force: true });
  });

  // Preparation over the live `snapshot` binding, so a test can edit the
  // config between — or during — turns.
  const preparation = () => {
    const config = createConfigStore(root);
    const configService: ConfigService = { current: () => snapshot, reload: () => snapshot };
    const turnTools = createTurnTools({
      db,
      config,
      configService,
      registry: createRegistry(),
      llmClients,
      toolPermissions: createToolPermissionStore(config.toolPermissionsFile()),
      commandLearning: {
        recordJudgement: () => {},
        recordResolution: () => {},
        guidance: () => "",
        flush: async () => {},
      },
      startTurn: () => {
        throw new Error("no turn starts in this test");
      },
    });
    return createTurnPreparation({
      db,
      config,
      configService,
      llmClients,
      bus: createEventBus(),
      turnTools,
    });
  };

  const promptOf = (prepared: PreparedTurn) =>
    prepared.turnDeps.buildSystemPrompt?.(prepared.session) ?? "";

  // The names of the tools a prepared turn offers once its stream starts.
  const toolNamesOf = ({ turnDeps }: PreparedTurn): string[] => {
    const { tools } = turnDeps;
    if (typeof tools !== "function") throw new Error("expected a tool factory");
    return Object.keys(tools({ writer: {} as UIMessageStreamWriter }));
  };

  it("prepares a session whose directory is usable without touching it or its prompt", () => {
    mkdirSync(join(root, "work"));
    const session = createSession(db, MODEL, { id: "s1", cwd: join(root, "work") });

    const prepared = preparation().prepareTurn(session);

    expect(prepared.session.cwd).toBe(join(root, "work"));
    expect(promptOf(prepared)).toContain(`The session's working directory is ${root}/work`);
    expect(promptOf(prepared)).not.toContain("moved to the configured default");
  });

  it("heals a stale directory and tells this turn's model about the move", () => {
    const session = createSession(db, MODEL, { id: "s1", cwd: join(root, "gone") });

    const prepared = preparation().prepareTurn(session);

    expect(prepared.session.cwd).toBe(root);
    expect(getSession(db, "s1")?.cwd).toBe(root);
    expect(promptOf(prepared)).toContain(`"${join(root, "gone")}" no longer exists`);
    expect(promptOf(prepared)).toContain(
      `moved to the configured default working directory, "${root}"`,
    );
  });

  it("drops the move notice once a later move supersedes the directory it names", () => {
    mkdirSync(join(root, "next"));
    const session = createSession(db, MODEL, { id: "s1", cwd: join(root, "gone") });
    const prepared = preparation().prepareTurn(session);

    // The model moved the session mid-turn; a later step rebuilds the prompt.
    const moved = updateSessionCwd(db, "s1", join(root, "next"));

    expect(prepared.turnDeps.buildSystemPrompt?.(moved)).not.toContain(
      "moved to the configured default",
    );
  });

  it("offers the tools and describes the sandbox of one snapshot for the whole turn", () => {
    const session = createSession(db, MODEL, { id: "s1", cwd: root });
    const prepared = preparation().prepareTurn(session);

    // A kiri.yaml edit lands while the turn runs.
    snapshot = { ...snapshot, filesystem: { allowedDirectories: [] } };

    expect(promptOf(prepared)).toContain(root);
    expect(toolNamesOf(prepared)).toContain("read_file");
    // The next turn sees the edit.
    expect(toolNamesOf(preparation().prepareTurn(prepared.session))).not.toContain("read_file");
  });
});
