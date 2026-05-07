import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { WORKFLOW_BRAND, defineWorkflow, isWorkflowDefinition } from "./define-workflow.ts";

describe("defineWorkflow", () => {
  it("returns the definition stamped with the brand", () => {
    const wf = defineWorkflow({
      name: "noop",
      inputSchema: z.object({}),
      nodes: [{ kind: "script", path: "scripts/noop.sh" }],
    });
    expect(wf.name).toBe("noop");
    expect(wf[WORKFLOW_BRAND]).toBe(true);
    expect(isWorkflowDefinition(wf)).toBe(true);
  });

  it("preserves optional fields when present", () => {
    const wf = defineWorkflow({
      name: "scheduled",
      inputSchema: z.object({}),
      nodes: [{ kind: "script", path: "x.sh" }],
      gating: "propose",
      schedule: "*/15 * * * *",
    });
    expect(wf.gating).toBe("propose");
    expect(wf.schedule).toBe("*/15 * * * *");
  });

  it("throws on empty name", () => {
    expect(() =>
      defineWorkflow({
        name: "",
        inputSchema: z.object({}),
        nodes: [{ kind: "script", path: "x.sh" }],
      }),
    ).toThrow();
  });

  it("throws when inputSchema is not a Zod schema", () => {
    expect(() =>
      defineWorkflow({
        name: "bad-input",
        // @ts-expect-error testing runtime guard
        inputSchema: { fake: true },
        nodes: [{ kind: "script", path: "x.sh" }],
      }),
    ).toThrow();
  });

  it("throws on empty nodes array", () => {
    expect(() =>
      defineWorkflow({
        name: "empty",
        inputSchema: z.object({}),
        nodes: [],
      }),
    ).toThrow();
  });

  it("throws on unknown node kind", () => {
    expect(() =>
      defineWorkflow({
        name: "bad-node",
        inputSchema: z.object({}),
        // @ts-expect-error testing runtime guard
        nodes: [{ kind: "agent", template: "x" }],
      }),
    ).toThrow();
  });

  it("throws on script node with empty path", () => {
    expect(() =>
      defineWorkflow({
        name: "empty-path",
        inputSchema: z.object({}),
        nodes: [{ kind: "script", path: "" }],
      }),
    ).toThrow();
  });

  it("throws on invalid gating value", () => {
    expect(() =>
      defineWorkflow({
        name: "bad-gating",
        inputSchema: z.object({}),
        nodes: [{ kind: "script", path: "x.sh" }],
        // @ts-expect-error testing runtime guard
        gating: "manual",
      }),
    ).toThrow();
  });
});

describe("isWorkflowDefinition", () => {
  it("returns false for non-objects", () => {
    expect(isWorkflowDefinition(null)).toBe(false);
    expect(isWorkflowDefinition(undefined)).toBe(false);
    expect(isWorkflowDefinition("foo")).toBe(false);
    expect(isWorkflowDefinition(42)).toBe(false);
  });

  it("returns false for plain objects without the brand", () => {
    expect(isWorkflowDefinition({ name: "foo" })).toBe(false);
  });
});
