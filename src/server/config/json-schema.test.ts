import { describe, expect, it } from "bun:test";
import { kiriConfigJsonSchema } from "./json-schema.ts";

type Branch = {
  properties: {
    type?: { const?: string };
    base_url?: { type?: string };
    api_key?: { type?: string; required?: string[]; additionalProperties?: boolean };
  };
  required?: string[];
  additionalProperties?: boolean;
};

const entryBranches = (): Branch[] => {
  const schema = kiriConfigJsonSchema() as {
    properties: { providers: { additionalProperties: { oneOf: Branch[] } } };
  };
  return schema.properties.providers.additionalProperties.oneOf;
};

const branchFor = (type: string): Branch | undefined =>
  entryBranches().find((b) => b.properties.type?.const === type);

describe("kiriConfigJsonSchema", () => {
  it("emits a Draft 2020-12 object schema with a providers map", () => {
    const schema = kiriConfigJsonSchema() as {
      $schema?: string;
      type?: string;
      additionalProperties?: boolean;
      properties?: { providers?: { type?: string } };
    };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.providers?.type).toBe("object");
  });

  it("models the provider entry as a union discriminated on type", () => {
    const consts = entryBranches().map((b) => b.properties.type?.const);
    expect(consts).toEqual(["anthropic", "openai", "openai-compatible"]);
  });

  it("requires type on every branch and base_url only on openai-compatible", () => {
    expect(branchFor("anthropic")?.required).toEqual(["type"]);
    expect(branchFor("openai")?.required).toEqual(["type"]);
    expect(branchFor("openai-compatible")?.required).toEqual(["type", "base_url"]);
  });

  it("constrains api_key to the { env } object form on every branch", () => {
    for (const branch of entryBranches()) {
      expect(branch.properties.api_key?.type).toBe("object");
      expect(branch.properties.api_key?.required).toEqual(["env"]);
      expect(branch.properties.api_key?.additionalProperties).toBe(false);
    }
  });

  it("rejects unknown keys on every branch", () => {
    for (const branch of entryBranches()) {
      expect(branch.additionalProperties).toBe(false);
    }
  });

  it("publishes the worktrees section with roots, defaults, and repos", () => {
    const schema = kiriConfigJsonSchema() as {
      properties: {
        worktrees: {
          type?: string;
          properties: {
            roots?: { type?: string };
            defaults?: { type?: string };
            repos?: { type?: string };
          };
          required?: string[];
        };
      };
    };
    const worktrees = schema.properties.worktrees;
    expect(worktrees.type).toBe("object");
    expect(worktrees.properties.roots?.type).toBe("array");
    expect(worktrees.properties.defaults?.type).toBe("object");
    expect(worktrees.properties.repos?.type).toBe("object");
    expect(worktrees.required).toEqual(["roots"]);
  });

  it("publishes the mcp servers map as a union discriminated on type", () => {
    const schema = kiriConfigJsonSchema() as {
      properties: {
        mcp: {
          type?: string;
          additionalProperties: { oneOf: { properties: { type?: { const?: string } } }[] };
        };
      };
    };
    expect(schema.properties.mcp.type).toBe("object");
    const consts = schema.properties.mcp.additionalProperties.oneOf.map(
      (b) => b.properties.type?.const,
    );
    expect(consts).toEqual(["stdio", "http"]);
  });
});
