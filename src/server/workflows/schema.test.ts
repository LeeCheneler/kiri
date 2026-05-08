import { describe, expect, it } from "bun:test";
import { workflowSchema } from "./schema.ts";

describe("workflowSchema", () => {
  it("parses a minimal valid workflow", () => {
    const result = workflowSchema.parse({
      name: "noop",
      nodes: [{ kind: "script", path: "scripts/noop.sh" }],
    });
    expect(result.name).toBe("noop");
    expect(result.nodes).toEqual([{ kind: "script", path: "scripts/noop.sh" }]);
  });

  it("preserves optional fields when present", () => {
    const result = workflowSchema.parse({
      name: "scheduled",
      nodes: [{ kind: "script", path: "x.sh" }],
      gating: "propose",
      schedule: "*/15 * * * *",
    });
    expect(result.gating).toBe("propose");
    expect(result.schedule).toBe("*/15 * * * *");
  });

  it("rejects empty name", () => {
    expect(() =>
      workflowSchema.parse({ name: "", nodes: [{ kind: "script", path: "x.sh" }] }),
    ).toThrow();
  });

  it("rejects empty nodes array", () => {
    expect(() => workflowSchema.parse({ name: "empty", nodes: [] })).toThrow();
  });

  it("rejects unknown node kind", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-node",
        nodes: [{ kind: "agent", template: "x" }],
      }),
    ).toThrow();
  });

  it("rejects script node with empty path", () => {
    expect(() =>
      workflowSchema.parse({
        name: "empty-path",
        nodes: [{ kind: "script", path: "" }],
      }),
    ).toThrow();
  });

  it("rejects invalid gating value", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-gating",
        nodes: [{ kind: "script", path: "x.sh" }],
        gating: "manual",
      }),
    ).toThrow();
  });

  it("rejects empty schedule string", () => {
    expect(() =>
      workflowSchema.parse({
        name: "bad-sched",
        nodes: [{ kind: "script", path: "x.sh" }],
        schedule: "",
      }),
    ).toThrow();
  });
});
