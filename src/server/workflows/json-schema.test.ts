import { describe, expect, it } from "bun:test";
import { workflowJsonSchema } from "./json-schema.ts";

describe("workflowJsonSchema", () => {
  it("emits a Draft 2020-12 schema with the expected top-level shape", () => {
    const schema = workflowJsonSchema() as {
      $schema?: string;
      type?: string;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["name", "nodes"]));
    expect(schema.properties).toMatchObject({
      name: { type: "string" },
      nodes: { type: "array" },
    });
  });

  it("describes script nodes with a literal kind discriminator and required path", () => {
    type Variant = {
      properties: { kind: { const: string }; path: { type: string } };
      required: string[];
    };
    const schema = workflowJsonSchema() as {
      properties: {
        nodes: {
          items: Variant | { oneOf: Variant[] } | { anyOf: Variant[] };
        };
      };
    };
    const items = schema.properties.nodes.items;
    const variants = "oneOf" in items ? items.oneOf : "anyOf" in items ? items.anyOf : [items];
    const script = variants.find((v) => v.properties.kind.const === "script");
    expect(script).toBeDefined();
    expect(script?.properties.path.type).toBe("string");
    expect(script?.required).toEqual(expect.arrayContaining(["kind", "path"]));
  });

  it("optionally permits gating and schedule fields", () => {
    const schema = workflowJsonSchema() as {
      required: string[];
      properties: {
        gating: { enum?: string[] };
        schedule: { type?: string };
      };
    };
    expect(schema.required).not.toContain("gating");
    expect(schema.required).not.toContain("schedule");
    expect(schema.properties.gating.enum).toEqual(expect.arrayContaining(["auto", "propose"]));
    expect(schema.properties.schedule.type).toBe("string");
  });
});
