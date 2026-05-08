import { describe, expect, it } from "bun:test";
import { isShStep, isUseStep, workflowSchema } from "./schema.ts";

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
});
