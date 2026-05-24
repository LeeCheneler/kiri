import { describe, expect, it } from "bun:test";
import { buildInputSchema } from "./build-input-schema.ts";
import type { WorkflowDefinition } from "./schema.ts";

const wf = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  name: "demo",
  steps: [{ sh: "echo hi" }],
  ...overrides,
});

const expectFailure = (result: ReturnType<ReturnType<typeof buildInputSchema>["safeParse"]>) => {
  if (result.success) throw new Error("expected schema to reject input");
  return result.error.issues;
};

describe("buildInputSchema", () => {
  describe("workflows without an inputs: block", () => {
    it("accepts an empty payload", () => {
      expect(buildInputSchema(wf()).safeParse({}).success).toBe(true);
    });

    it("rejects a non-empty payload with an unrecognized_keys issue listing every extra key", () => {
      const issues = expectFailure(
        buildInputSchema(wf()).safeParse({ pr_number: "42", owner: "kiri" }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("unrecognized_keys");
      expect((issues[0] as { keys?: string[] }).keys).toEqual(["pr_number", "owner"]);
    });
  });

  describe("workflows with an inputs: block", () => {
    it("accepts a payload that satisfies required inputs", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      expect(buildInputSchema(def).safeParse({ pr_number: "42" }).success).toBe(true);
    });

    it("accepts an empty payload when no inputs are required", () => {
      const def = wf({ inputs: [{ name: "branch", default: "main" }] });
      expect(buildInputSchema(def).safeParse({}).success).toBe(true);
    });

    it("accepts a payload omitting an optional input", () => {
      const def = wf({
        inputs: [{ name: "pr_number", required: true }, { name: "owner" }],
      });
      expect(buildInputSchema(def).safeParse({ pr_number: "42" }).success).toBe(true);
    });

    it("rejects an unknown key with an unrecognized_keys issue", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      const issues = expectFailure(
        buildInputSchema(def).safeParse({ pr_number: "42", surprise: "x" }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("unrecognized_keys");
      expect((issues[0] as { keys?: string[] }).keys).toEqual(["surprise"]);
    });

    it("rejects a missing required input with the canonical message", () => {
      const def = wf({
        inputs: [{ name: "pr_number", required: true }, { name: "owner" }],
      });
      const issues = expectFailure(buildInputSchema(def).safeParse({ owner: "kiri" }));
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: ["pr_number"],
          message: 'input "pr_number" is required',
        }),
      );
    });

    it("rejects a required input supplied as an empty string with the same message", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      const issues = expectFailure(buildInputSchema(def).safeParse({ pr_number: "" }));
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: ["pr_number"],
          message: 'input "pr_number" is required',
        }),
      );
    });

    it("accepts a required input whose value is whitespace (length-only check)", () => {
      const def = wf({ inputs: [{ name: "pr_number", required: true }] });
      expect(buildInputSchema(def).safeParse({ pr_number: " " }).success).toBe(true);
    });

    it("treats required-with-default as required: missing payload still fails", () => {
      const def = wf({
        inputs: [{ name: "branch", required: true, default: "main" }],
      });
      const issues = expectFailure(buildInputSchema(def).safeParse({}));
      expect(issues).toContainEqual(
        expect.objectContaining({
          path: ["branch"],
          message: 'input "branch" is required',
        }),
      );
    });
  });

  describe("inputs with declared options", () => {
    it("accepts a supplied value that matches one of the declared options", () => {
      const def = wf({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      });
      expect(buildInputSchema(def).safeParse({ env_target: "staging" }).success).toBe(true);
    });

    it("rejects a supplied value that isn't one of the declared options", () => {
      const def = wf({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      });
      const issues = expectFailure(buildInputSchema(def).safeParse({ env_target: "qa" }));
      expect(issues).toContainEqual(
        expect.objectContaining({
          message: 'input "env_target" value "qa" is not one of the declared options',
        }),
      );
    });

    it("accepts an optional picklist input omitted from the payload", () => {
      const def = wf({
        inputs: [{ name: "env_target", options: ["dev", "staging", "prod"] }],
      });
      expect(buildInputSchema(def).safeParse({}).success).toBe(true);
    });

    it("reports an empty-string value on a required picklist input as missing, not out-of-options", () => {
      const def = wf({
        inputs: [{ name: "env_target", required: true, options: ["dev", "staging", "prod"] }],
      });
      const issues = expectFailure(buildInputSchema(def).safeParse({ env_target: "" }));
      // The required/min(1) check fires before superRefine, so the options
      // check is automatically skipped — only the "is required" issue surfaces.
      expect(issues).toContainEqual(
        expect.objectContaining({ message: 'input "env_target" is required' }),
      );
      const optionsIssue = issues.find((i) =>
        i.message.includes("not one of the declared options"),
      );
      expect(optionsIssue).toBeUndefined();
    });
  });
});
