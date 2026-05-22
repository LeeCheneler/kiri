import { describe, expect, it } from "bun:test";
import type { WorkflowDefinition } from "./schema.ts";
import { validateInputs } from "./validate-inputs.ts";

const wf = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  name: "demo",
  steps: [{ sh: "echo hi" }],
  ...overrides,
});

describe("validateInputs", () => {
  describe("workflows without an inputs: block", () => {
    it("accepts an empty payload", () => {
      expect(validateInputs(wf(), {})).toEqual({ ok: true });
    });

    it("rejects a non-empty payload naming the offending keys", () => {
      const result = validateInputs(wf(), { pr_number: "42", owner: "kiri" });
      expect(result).toEqual({
        ok: false,
        error: 'workflow "demo" declares no inputs; received: pr_number, owner',
      });
    });
  });

  describe("workflows with an inputs: block", () => {
    it("accepts a payload that satisfies required inputs", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      expect(validateInputs(def, { pr_number: "42" })).toEqual({ ok: true });
    });

    it("accepts an empty payload when no inputs are required", () => {
      const def = wf({ inputs: [{ name: "branch", default: "main" }] });
      expect(validateInputs(def, {})).toEqual({ ok: true });
    });

    it("accepts a payload omitting an optional input", () => {
      const def = wf({
        inputs: [{ name: "pr_number", required: true }, { name: "owner" }],
      });
      expect(validateInputs(def, { pr_number: "42" })).toEqual({ ok: true });
    });

    it("rejects an unknown key", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      expect(validateInputs(def, { pr_number: "42", surprise: "x" })).toEqual({
        ok: false,
        error: 'unknown input "surprise"',
      });
    });

    it("rejects a missing required input", () => {
      const def = wf({
        inputs: [{ name: "pr_number", required: true }, { name: "owner" }],
      });
      expect(validateInputs(def, { owner: "kiri" })).toEqual({
        ok: false,
        error: 'input "pr_number" is required',
      });
    });

    it("rejects a required input supplied as an empty string", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      expect(validateInputs(def, { pr_number: "" })).toEqual({
        ok: false,
        error: 'input "pr_number" is required',
      });
    });

    it("accepts a required input whose value is whitespace", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      expect(validateInputs(def, { pr_number: " " })).toEqual({ ok: true });
    });

    it("treats required-with-default as required: missing payload still fails", () => {
      const def = wf({
        inputs: [{ name: "branch", required: true, default: "main" }],
      });
      expect(validateInputs(def, {})).toEqual({
        ok: false,
        error: 'input "branch" is required',
      });
    });

    it("reports the unknown key before the missing required input", () => {
      const def = wf({
        inputs: [{ name: "pr_number", required: true }],
      });
      expect(validateInputs(def, { surprise: "x" })).toEqual({
        ok: false,
        error: 'unknown input "surprise"',
      });
    });
  });
});
