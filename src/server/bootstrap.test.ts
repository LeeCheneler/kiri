import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.ts";
import { llmProvidersJsonSchema } from "./llm/index.ts";
import { workflowJsonSchema } from "./workflows/index.ts";

describe("bootstrap", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-bootstrap-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scaffolds workflows/, .kiri/state.db, and the workflow schema on a fresh launch", () => {
    const db = bootstrap(dir);
    expect(existsSync(join(dir, "workflows"))).toBe(true);
    expect(existsSync(join(dir, ".kiri"))).toBe(true);
    expect(existsSync(join(dir, ".kiri", "state.db"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, ".kiri", "workflow.schema.json"), "utf8"))).toEqual(
      workflowJsonSchema(),
    );
    expect(
      JSON.parse(readFileSync(join(dir, ".kiri", "llm-providers.schema.json"), "utf8")),
    ).toEqual(llmProvidersJsonSchema());
    db.$client.close();
  });

  it("refreshes both schemas on every launch", () => {
    const first = bootstrap(dir);
    first.$client.close();

    const schemaPath = join(dir, ".kiri", "workflow.schema.json");
    const llmSchemaPath = join(dir, ".kiri", "llm-providers.schema.json");
    writeFileSync(schemaPath, '{ "stale": true }');
    writeFileSync(llmSchemaPath, '{ "stale": true }');

    const second = bootstrap(dir);
    second.$client.close();
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(workflowJsonSchema());
    expect(JSON.parse(readFileSync(llmSchemaPath, "utf8"))).toEqual(llmProvidersJsonSchema());
  });

  it("is idempotent on re-launch", () => {
    const first = bootstrap(dir);
    first.$client.close();
    const second = bootstrap(dir);
    second.$client.close();
  });
});
