import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workflowJsonSchema } from "./workflows/index.ts";

/** Contents of the scaffolded repo-root `README.md`. */
export const KIRI_README = `# Kiri

This is a kiri workflow repo. Kiri is a local-first, git-based workflow
orchestrator — run \`kiri\` in this directory to start it and visit the local
URL it prints.

## Workflow definitions

Workflow files live in \`workflows/\` as \`*.yaml\` files. Each file defines a
single workflow. Kiri loads them on startup, validates each against
\`.kiri/workflow.schema.json\`, and registers it by \`name\`.

### Shape

\`\`\`yaml
name: my-workflow
nodes:
  - kind: script
    path: scripts/my-workflow/step.sh
\`\`\`

Workflows are linear pipelines — each node's output feeds the next. No
branches, conditionals, or fan-out/fan-in.

### Node kinds

#### \`script\`

Runs an executable script. The script receives the prior node's output on
stdin (or nothing for the first node) and writes its output to stdout. Exit
code 0 = ok; non-zero halts the workflow.

\`\`\`yaml
- kind: script
  path: scripts/example/hello.sh   # path relative to the repo root
\`\`\`

Additional node kinds (e.g. \`agent\` for Claude Code invocations) will land
in future kiri releases.

## IDE / LSP integration

Kiri publishes the workflow JSON Schema at \`.kiri/workflow.schema.json\` and
refreshes it on every startup, so editor validation and autocomplete stays in
sync after you upgrade kiri.

### VS Code (Red Hat YAML extension)

The simplest setup is the modeline at the top of each workflow file (the
generated \`workflows/example.yaml\` has one):

\`\`\`yaml
# yaml-language-server: $schema=../.kiri/workflow.schema.json
\`\`\`

Or configure \`yaml.schemas\` in your workspace \`.vscode/settings.json\`:

\`\`\`json
{
  "yaml.schemas": {
    ".kiri/workflow.schema.json": "workflows/*.yaml"
  }
}
\`\`\`

### JetBrains IDEs

Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings.
Map \`.kiri/workflow.schema.json\` to \`workflows/*.yaml\`.

## Re-running \`kiri init\`

Safe — existing files are never overwritten; only the schema is refreshed.
`;

/** Contents of the scaffolded `workflows/example.yaml`. */
export const EXAMPLE_WORKFLOW_YAML = `# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: example
nodes:
  - kind: script
    path: scripts/example/hello.sh
`;

/** Contents of the scaffolded example script — paired with the example workflow. */
export const EXAMPLE_HELLO_SCRIPT = `#!/bin/sh
echo "hello from kiri"
`;

/** Relative paths reported by `initRepo`. */
const SCHEMA_REL_PATH = ".kiri/workflow.schema.json";
const README_REL_PATH = "README.md";
const EXAMPLE_REL_PATH = "workflows/example.yaml";
const EXAMPLE_SCRIPT_REL_PATH = "scripts/example/hello.sh";
const GITIGNORE_REL_PATH = ".gitignore";
const GITIGNORE_KIRI_LINE = ".kiri/";

/** Structured summary of what `initRepo` did, suitable for logging by the CLI. */
export interface InitResult {
  /** Repo-relative paths of files newly written. */
  created: string[];
  /** Repo-relative paths of files that already existed and were left untouched. */
  skipped: string[];
  /** Repo-relative path of the schema file (always (re)written). */
  schemaPath: string;
  /** True if `.gitignore` was created or appended to add the `.kiri/` line. */
  gitignoreUpdated: boolean;
}

/**
 * (Re)write `.kiri/workflow.schema.json` from the live Zod schema. Called by
 * both `initRepo` and on every kiri startup so the schema file stays in sync
 * after a binary upgrade — no need to re-run `init` to refresh it.
 */
export function writeSchemaFile(cwd: string): string {
  const dir = join(cwd, ".kiri");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "workflow.schema.json");
  writeFileSync(path, `${JSON.stringify(workflowJsonSchema(), null, 2)}\n`);
  return path;
}

const writeIfMissing = (
  absPath: string,
  relPath: string,
  contents: string,
  created: string[],
  skipped: string[],
  mode?: number,
): void => {
  if (existsSync(absPath)) {
    skipped.push(relPath);
    return;
  }
  writeFileSync(absPath, contents);
  if (mode !== undefined) chmodSync(absPath, mode);
  created.push(relPath);
};

const ensureKiriIgnored = (cwd: string): boolean => {
  const path = join(cwd, GITIGNORE_REL_PATH);
  if (!existsSync(path)) {
    writeFileSync(path, `${GITIGNORE_KIRI_LINE}\n`);
    return true;
  }

  const current = readFileSync(path, "utf8");
  const hasLine = current
    .split("\n")
    .some((line) => line.trim() === ".kiri" || line.trim() === ".kiri/");
  if (hasLine) return false;

  const trailing = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${trailing}${GITIGNORE_KIRI_LINE}\n`);
  return true;
};

/**
 * Bootstrap a kiri-ready repo at `cwd`: scaffold `workflows/` with a README
 * and example workflow, (re)write the JSON Schema file, and add `.kiri/` to
 * `.gitignore` if one exists. User-authored README/YAML files are never
 * overwritten — only missing files are created. The schema file is always
 * refreshed.
 */
export function initRepo(cwd: string): InitResult {
  const workflowsDir = join(cwd, "workflows");
  const exampleScriptDir = join(cwd, "scripts", "example");
  mkdirSync(workflowsDir, { recursive: true });
  mkdirSync(exampleScriptDir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  writeIfMissing(join(cwd, "README.md"), README_REL_PATH, KIRI_README, created, skipped);
  writeIfMissing(
    join(workflowsDir, "example.yaml"),
    EXAMPLE_REL_PATH,
    EXAMPLE_WORKFLOW_YAML,
    created,
    skipped,
  );
  writeIfMissing(
    join(exampleScriptDir, "hello.sh"),
    EXAMPLE_SCRIPT_REL_PATH,
    EXAMPLE_HELLO_SCRIPT,
    created,
    skipped,
    0o755,
  );

  writeSchemaFile(cwd);
  const gitignoreUpdated = ensureKiriIgnored(cwd);

  return {
    created,
    skipped,
    schemaPath: SCHEMA_REL_PATH,
    gitignoreUpdated,
  };
}
