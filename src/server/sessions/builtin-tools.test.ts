import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "../config/store.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { LlmClients } from "../llm/index.ts";
import { createRegistry } from "../workflows/index.ts";
import { articleTools } from "./article-tools.ts";
import { BUILTIN_TOOLS } from "./builtin-tools.ts";
import { delegateTool } from "./delegate-tool.ts";
import { filesystemTools } from "./filesystem-tools.ts";
import { imageTools } from "./image-tools.ts";
import { sessionTitleTools } from "./session-title-tool.ts";
import { shellTools } from "./shell-tools.ts";
import { workflowTools } from "./workflow-tools.ts";

// The merged-set check only reads tool names; no client method ever runs.
const stubClients: LlmClients = {
  resolveModel: () => {
    throw new Error("unused");
  },
  resolveImageModel: () => {
    throw new Error("unused");
  },
  generateText: async () => ({ text: "", usage: {} }),
  listModels: async () => ({ models: [], failures: [] }),
  contextWindowFor: async () => undefined,
  reasoningOptionsFor: async () => undefined,
};

describe("BUILTIN_TOOLS", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-builtin-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // The registry is the session routes' source of truth for which built-in
  // tools exist: each entry is offered by looking its name up in the merged
  // first-party toolset. A tool added to either side without the other would
  // ship un-gated or broken, so pin the two to exact agreement.
  it("names every first-party session tool exactly once", () => {
    const offered = {
      ...workflowTools({ db, registry: createRegistry(), config: createConfigStore(dir) }),
      ...articleTools(db, "session-1", () => {}),
      ...sessionTitleTools(db, "session-1", () => {}),
      ...filesystemTools(() => [dir]),
      ...shellTools(() => [dir]),
      ...imageTools({ db, sessionId: "session-1", llmClients: stubClients }),
      ...delegateTool({
        db,
        parentSessionId: "session-1",
        childTurnDeps: () => ({ db, llmClients: stubClients }),
      }),
    };
    expect(BUILTIN_TOOLS.map((tool) => tool.name).sort()).toEqual(Object.keys(offered).sort());
  });
});
