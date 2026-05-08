import { describe, expect, it } from "bun:test";
import { createRegistry } from "./registry.ts";
import type { WorkflowDefinition } from "./schema.ts";

const make = (name: string): WorkflowDefinition => ({
  name,
  steps: [{ use: name }],
});

describe("registry", () => {
  it("starts empty", () => {
    const reg = createRegistry();
    expect(reg.listWorkflows()).toEqual([]);
    expect(reg.getWorkflow("missing")).toBeUndefined();
  });

  it("exposes workflows put in via replace", () => {
    const reg = createRegistry();
    const a = make("a");
    const b = make("b");
    reg.replace(
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );

    expect(reg.getWorkflow("a")).toBe(a);
    expect(reg.getWorkflow("b")).toBe(b);
    expect(reg.listWorkflows()).toEqual([a, b]);
  });

  it("replace swaps contents wholesale", () => {
    const reg = createRegistry();
    reg.replace(new Map([["a", make("a")]]));

    const c = make("c");
    reg.replace(new Map([["c", c]]));
    expect(reg.getWorkflow("a")).toBeUndefined();
    expect(reg.listWorkflows()).toEqual([c]);
  });
});
