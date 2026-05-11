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

  it("preserves optional fields when present", () => {
    const result = workflowSchema.parse({
      name: "scheduled",
      steps: [{ use: "x" }],
      gating: "propose",
      schedule: "*/15 * * * *",
    });
    expect(result.gating).toBe("propose");
    expect(result.schedule).toBe("*/15 * * * *");
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

  it("rejects invalid gating value", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-gating",
        steps: [{ use: "x" }],
        gating: "manual",
      }),
    ).toThrow();
  });

  it("rejects empty schedule string", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-sched",
        steps: [{ use: "x" }],
        schedule: "",
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
