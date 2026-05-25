import { describe, expect, it } from "bun:test";
import { isShPublish, isShStep, isUsePublish, isUseStep, workflowSchema } from "./schema.ts";

describe("workflowSchema", () => {
  it("parses a minimal valid workflow with a use: step", () => {
    const result = workflowSchema.parse({
      name: "noop",
      steps: [{ use: "noop" }],
    });
    expect(result.name).toBe("noop");
    expect(result.steps).toEqual([{ use: "noop" }]);
  });

  it("parses an inline sh: step", () => {
    const result = workflowSchema.parse({
      name: "shellish",
      steps: [{ sh: "echo hi" }],
    });
    expect(result.steps).toEqual([{ sh: "echo hi" }]);
  });

  it("parses a mixed-variant pipeline with env maps", () => {
    const result = workflowSchema.parse({
      name: "mix",
      steps: [{ use: "fetch", env: { FOO: "bar" } }, { sh: "cat" }],
    });
    expect(result.steps).toHaveLength(2);
    const [first, second] = result.steps;
    expect(isUseStep(first)).toBe(true);
    expect(isShStep(second)).toBe(true);
  });

  it("rejects empty name", () => {
    expect(() => workflowSchema.parse({ name: "", steps: [{ use: "x" }] })).toThrow();
  });

  it("rejects empty steps array", () => {
    expect(() => workflowSchema.parse({ name: "empty", steps: [] })).toThrow();
  });

  it("rejects a step with both use and sh keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "ambiguous",
        steps: [{ use: "a", sh: "echo b" }],
      }),
    ).toThrow();
  });

  it("rejects a step with neither use nor sh", () => {
    expect(() =>
      workflowSchema.parse({
        name: "neither",
        steps: [{ env: { FOO: "bar" } }],
      }),
    ).toThrow();
  });

  it("rejects use: with empty name", () => {
    expect(() => workflowSchema.parse({ name: "empty-use", steps: [{ use: "" }] })).toThrow();
  });

  it("rejects sh: with empty body", () => {
    expect(() => workflowSchema.parse({ name: "empty-sh", steps: [{ sh: "" }] })).toThrow();
  });

  it("rejects env: keys starting with KIRI_", () => {
    expect(() =>
      workflowSchema.parse({
        name: "reserved",
        steps: [{ use: "x", env: { KIRI_RUN_ID: "spoofed" } }],
      }),
    ).toThrow();
  });

  it("rejects unknown extra keys on a step", () => {
    expect(() =>
      workflowSchema.parse({
        name: "extras",
        steps: [{ use: "x", path: "scripts/x/run.sh" }],
      }),
    ).toThrow();
  });

  it("parses a step with an optional description on use:", () => {
    const result = workflowSchema.parse({
      name: "described",
      steps: [{ use: "x", description: "fetch the latest PRs" }],
    });
    expect(result.steps[0]).toEqual({ use: "x", description: "fetch the latest PRs" });
  });

  it("parses a step with an optional description on sh:", () => {
    const result = workflowSchema.parse({
      name: "described-sh",
      steps: [{ sh: "echo hi", description: "smoke test" }],
    });
    expect(result.steps[0]).toEqual({ sh: "echo hi", description: "smoke test" });
  });

  it("rejects an empty description on a step", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-desc",
        steps: [{ use: "x", description: "" }],
      }),
    ).toThrow();
  });

  it("parses a workflow with a use: summarize step", () => {
    const result = workflowSchema.parse({
      name: "summed",
      steps: [{ use: "x" }],
      summarize: { use: "claude-code-summarizer" },
    });
    expect(result.summarize).toEqual({ use: "claude-code-summarizer" });
  });

  it("parses a workflow with an inline sh: summarize step", () => {
    const result = workflowSchema.parse({
      name: "summed-sh",
      steps: [{ use: "x" }],
      summarize: { sh: "head -c 200" },
    });
    expect(result.summarize).toEqual({ sh: "head -c 200" });
  });

  it("treats summarize as optional", () => {
    const result = workflowSchema.parse({
      name: "no-sum",
      steps: [{ use: "x" }],
    });
    expect(result.summarize).toBeUndefined();
  });

  it("rejects a summarize step with both use and sh keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "ambig-sum",
        steps: [{ use: "x" }],
        summarize: { use: "a", sh: "echo b" },
      }),
    ).toThrow();
  });

  it("rejects a summarize step with neither use nor sh", () => {
    expect(() =>
      workflowSchema.parse({
        name: "neither-sum",
        steps: [{ use: "x" }],
        summarize: { env: { FOO: "bar" } },
      }),
    ).toThrow();
  });

  it("rejects a summarize step with KIRI_-prefixed env keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "reserved-sum",
        steps: [{ use: "x" }],
        summarize: { use: "y", env: { KIRI_RUN_ID: "spoofed" } },
      }),
    ).toThrow();
  });

  it("parses a summarize step with an optional description", () => {
    const result = workflowSchema.parse({
      name: "described-sum",
      steps: [{ use: "x" }],
      summarize: { use: "y", description: "one-line digest" },
    });
    expect(result.summarize).toEqual({ use: "y", description: "one-line digest" });
  });

  it("rejects a summarize step with unknown extra keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "extras-sum",
        steps: [{ use: "x" }],
        summarize: { use: "y", path: "scripts/y/run.sh" },
      }),
    ).toThrow();
  });

  it("parses a workflow with a use: publish entry", () => {
    const result = workflowSchema.parse({
      name: "pub",
      steps: [{ use: "x" }],
      publish: [{ name: "digest", use: "writer" }],
    });
    expect(result.publish).toEqual([{ name: "digest", use: "writer" }]);
    const [entry] = result.publish ?? [];
    expect(isUsePublish(entry)).toBe(true);
  });

  it("parses a workflow with an inline sh: publish entry", () => {
    const result = workflowSchema.parse({
      name: "pub-sh",
      steps: [{ use: "x" }],
      publish: [{ name: "digest", sh: "cat" }],
    });
    expect(result.publish).toEqual([{ name: "digest", sh: "cat" }]);
    const [entry] = result.publish ?? [];
    expect(isShPublish(entry)).toBe(true);
  });

  it("parses a publish entry with explicit title and env", () => {
    const result = workflowSchema.parse({
      name: "pub-full",
      steps: [{ use: "x" }],
      publish: [
        {
          name: "digest",
          title: "Top Stories",
          use: "writer",
          env: { FOO: "bar" },
        },
      ],
    });
    expect(result.publish?.[0]).toEqual({
      name: "digest",
      title: "Top Stories",
      use: "writer",
      env: { FOO: "bar" },
    });
  });

  it("treats publish as optional", () => {
    const result = workflowSchema.parse({
      name: "no-pub",
      steps: [{ use: "x" }],
    });
    expect(result.publish).toBeUndefined();
  });

  it("rejects a publish entry whose name doesn't match ^[a-z0-9-]+$", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-pub",
        steps: [{ use: "x" }],
        publish: [{ name: "Bad-Name", use: "writer" }],
      }),
    ).toThrow();
  });

  it("rejects duplicate publish names within a workflow", () => {
    expect(() =>
      workflowSchema.parse({
        name: "dup-pub",
        steps: [{ use: "x" }],
        publish: [
          { name: "digest", use: "writer" },
          { name: "digest", sh: "cat" },
        ],
      }),
    ).toThrow();
  });

  it("rejects a publish entry with both use and sh keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "ambig-pub",
        steps: [{ use: "x" }],
        publish: [{ name: "digest", use: "a", sh: "echo b" }],
      }),
    ).toThrow();
  });

  it("rejects a publish entry with neither use nor sh", () => {
    expect(() =>
      workflowSchema.parse({
        name: "neither-pub",
        steps: [{ use: "x" }],
        publish: [{ name: "digest", env: { FOO: "bar" } }],
      }),
    ).toThrow();
  });

  it("rejects a publish entry with KIRI_-prefixed env keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "reserved-pub",
        steps: [{ use: "x" }],
        publish: [{ name: "digest", use: "writer", env: { KIRI_RUN_ID: "spoofed" } }],
      }),
    ).toThrow();
  });

  it("parses a publish entry with an optional description", () => {
    const result = workflowSchema.parse({
      name: "pub-desc",
      steps: [{ use: "x" }],
      publish: [{ name: "digest", description: "weekly summary", use: "writer" }],
    });
    expect(result.publish?.[0]).toEqual({
      name: "digest",
      description: "weekly summary",
      use: "writer",
    });
  });

  it("rejects an empty description on a publish entry", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-desc-pub",
        steps: [{ use: "x" }],
        publish: [{ name: "digest", description: "", use: "writer" }],
      }),
    ).toThrow();
  });

  it("rejects a publish entry with unknown extra keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "extras-pub",
        steps: [{ use: "x" }],
        publish: [{ name: "digest", use: "writer", path: "scripts/writer/run.sh" }],
      }),
    ).toThrow();
  });

  it("rejects a publish entry missing name", () => {
    expect(() =>
      workflowSchema.parse({
        name: "no-name-pub",
        steps: [{ use: "x" }],
        publish: [{ use: "writer" }],
      }),
    ).toThrow();
  });

  it("parses a workflow with a single minimal input", () => {
    const result = workflowSchema.parse({
      name: "with-inputs",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x" }],
    });
    expect(result.inputs).toEqual([{ name: "pr_number" }]);
  });

  it("parses an input with all optional fields", () => {
    const result = workflowSchema.parse({
      name: "full-input",
      inputs: [
        {
          name: "pr_number",
          description: "PR to review",
          required: true,
          default: "1",
        },
      ],
      steps: [{ use: "x" }],
    });
    expect(result.inputs?.[0]).toEqual({
      name: "pr_number",
      description: "PR to review",
      required: true,
      default: "1",
    });
  });

  it("treats inputs as optional", () => {
    const result = workflowSchema.parse({
      name: "no-inputs",
      steps: [{ use: "x" }],
    });
    expect(result.inputs).toBeUndefined();
  });

  it("rejects an empty inputs array when the key is present", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-inputs",
        inputs: [],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects duplicate input names", () => {
    expect(() =>
      workflowSchema.parse({
        name: "dup-input",
        inputs: [{ name: "pr_number" }, { name: "pr_number" }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("accepts input names that start with an underscore and contain digits", () => {
    const result = workflowSchema.parse({
      name: "underscore-input",
      inputs: [{ name: "_my_input_42" }],
      steps: [{ use: "x" }],
    });
    expect(result.inputs?.[0].name).toBe("_my_input_42");
  });

  it("rejects an input name that starts with a digit", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-input-name",
        inputs: [{ name: "1pr" }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an input name with uppercase letters", () => {
    expect(() =>
      workflowSchema.parse({
        name: "uppercase-input",
        inputs: [{ name: "PrNumber" }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an input name containing a dash", () => {
    expect(() =>
      workflowSchema.parse({
        name: "dashed-input",
        inputs: [{ name: "pr-number" }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an input with unknown extra keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "extras-input",
        inputs: [{ name: "pr_number", type: "string" }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an input with empty description", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-desc-input",
        inputs: [{ name: "pr_number", description: "" }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("parses an input declaring a list of allowed options", () => {
    const result = workflowSchema.parse({
      name: "picklist",
      inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      steps: [{ use: "x" }],
    });
    expect(result.inputs?.[0].options).toEqual(["dev", "staging", "prod"]);
  });

  it("parses a picklist input whose default is one of the declared options", () => {
    const result = workflowSchema.parse({
      name: "picklist-default",
      inputs: [{ name: "env_target", options: ["dev", "staging", "prod"], default: "staging" }],
      steps: [{ use: "x" }],
    });
    expect(result.inputs?.[0]).toEqual({
      name: "env_target",
      options: ["dev", "staging", "prod"],
      default: "staging",
    });
  });

  it("rejects an empty options array", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-options",
        inputs: [{ name: "env_target", options: [] }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an options entry that isn't a string", () => {
    expect(() =>
      workflowSchema.parse({
        name: "non-string-option",
        inputs: [{ name: "env_target", options: ["dev", 42] }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects an empty-string options entry", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-string-option",
        inputs: [{ name: "env_target", options: ["dev", ""] }],
        steps: [{ use: "x" }],
      }),
    ).toThrow();
  });

  it("rejects duplicate values within an input's options", () => {
    const result = workflowSchema.safeParse({
      name: "dup-options",
      inputs: [{ name: "env_target", options: ["dev", "prod", "dev"] }],
      steps: [{ use: "x" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("duplicate");
      expect(result.error.message).toContain("dev");
    }
  });

  it("rejects a default value that isn't one of the declared options", () => {
    const result = workflowSchema.safeParse({
      name: "default-out-of-options",
      inputs: [{ name: "env_target", options: ["dev", "staging", "prod"], default: "qa" }],
      steps: [{ use: "x" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("not one of the declared options");
      expect(result.error.message).toContain("qa");
    }
  });

  it("parses a step env that references a declared input", () => {
    const result = workflowSchema.parse({
      name: "ref-env",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x", env: { PR_NUMBER: { input: "pr_number" } } }],
    });
    expect(result.steps[0].env).toEqual({ PR_NUMBER: { input: "pr_number" } });
  });

  it("parses a step env mixing string values and input refs", () => {
    const result = workflowSchema.parse({
      name: "mixed-env",
      inputs: [{ name: "pr_number" }],
      steps: [
        {
          use: "x",
          env: {
            PR_NUMBER: { input: "pr_number" },
            MAX_RETRIES: "3",
          },
        },
      ],
    });
    expect(result.steps[0].env).toEqual({
      PR_NUMBER: { input: "pr_number" },
      MAX_RETRIES: "3",
    });
  });

  it("rejects an env input ref with an empty name", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-ref",
        inputs: [{ name: "pr_number" }],
        steps: [{ use: "x", env: { PR_NUMBER: { input: "" } } }],
      }),
    ).toThrow();
  });

  it("rejects an env input ref with unknown extra keys", () => {
    expect(() =>
      workflowSchema.parse({
        name: "ref-extras",
        inputs: [{ name: "pr_number" }],
        steps: [{ use: "x", env: { PR_NUMBER: { input: "pr_number", default: "1" } } }],
      }),
    ).toThrow();
  });

  it("rejects a step env that references an undeclared input", () => {
    const result = workflowSchema.safeParse({
      name: "undeclared-step-ref",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x", env: { TARGET: { input: "ghost" } } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("undeclared input");
      expect(result.error.message).toContain("ghost");
    }
  });

  it("rejects an env ref when no inputs are declared at all", () => {
    const result = workflowSchema.safeParse({
      name: "no-inputs-but-ref",
      steps: [{ use: "x", env: { TARGET: { input: "ghost" } } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("ghost");
    }
  });

  it("rejects a summarize env that references an undeclared input", () => {
    const result = workflowSchema.safeParse({
      name: "undeclared-summarize-ref",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x" }],
      summarize: { use: "summer", env: { LABEL: { input: "ghost" } } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("ghost");
    }
  });

  it("rejects a publish env that references an undeclared input", () => {
    const result = workflowSchema.safeParse({
      name: "undeclared-publish-ref",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x" }],
      publish: [{ name: "digest", use: "writer", env: { LABEL: { input: "ghost" } } }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("ghost");
    }
  });

  it("parses a workflow whose summarize env references a declared input", () => {
    const result = workflowSchema.parse({
      name: "summarize-ref",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x" }],
      summarize: { use: "summer", env: { LABEL: { input: "pr_number" } } },
    });
    expect(result.summarize?.env).toEqual({ LABEL: { input: "pr_number" } });
  });

  it("parses a workflow whose publish env references a declared input", () => {
    const result = workflowSchema.parse({
      name: "publish-ref",
      inputs: [{ name: "pr_number" }],
      steps: [{ use: "x" }],
      publish: [{ name: "digest", use: "writer", env: { LABEL: { input: "pr_number" } } }],
    });
    expect(result.publish?.[0].env).toEqual({ LABEL: { input: "pr_number" } });
  });
});

describe("isUsePublish / isShPublish", () => {
  it("narrows a use: publish entry", () => {
    const entry = { name: "digest", use: "writer" } as const;
    expect(isUsePublish(entry)).toBe(true);
    expect(isShPublish(entry)).toBe(false);
  });

  it("narrows an sh: publish entry", () => {
    const entry = { name: "digest", sh: "cat" } as const;
    expect(isShPublish(entry)).toBe(true);
    expect(isUsePublish(entry)).toBe(false);
  });
});
