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
    expect(schema.required).toEqual(expect.arrayContaining(["name", "steps"]));
    expect(schema.properties).toMatchObject({
      name: { type: "string" },
      steps: { type: "array" },
    });
  });

  it("describes step variants for use: and sh:", () => {
    type Variant = {
      properties: { use?: { type: string }; sh?: { type: string } };
      required?: string[];
    };
    const schema = workflowJsonSchema() as {
      properties: {
        steps: {
          items: Variant | { oneOf: Variant[] } | { anyOf: Variant[] };
        };
      };
    };
    const items = schema.properties.steps.items;
    const variants = "oneOf" in items ? items.oneOf : "anyOf" in items ? items.anyOf : [items];
    const useVariant = variants.find((v) => v.properties.use !== undefined);
    const shVariant = variants.find((v) => v.properties.sh !== undefined);
    expect(useVariant).toBeDefined();
    expect(shVariant).toBeDefined();
    expect(useVariant?.properties.use?.type).toBe("string");
    expect(shVariant?.properties.sh?.type).toBe("string");
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

  it("optionally permits a summarize field with the step variant shape", () => {
    type Variant = { properties: { use?: { type: string }; sh?: { type: string } } };
    const schema = workflowJsonSchema() as {
      required: string[];
      properties: {
        summarize: Variant | { oneOf: Variant[] } | { anyOf: Variant[] };
      };
    };
    expect(schema.required).not.toContain("summarize");
    const summarize = schema.properties.summarize;
    const variants =
      "oneOf" in summarize ? summarize.oneOf : "anyOf" in summarize ? summarize.anyOf : [summarize];
    const useVariant = variants.find((v) => v.properties.use !== undefined);
    const shVariant = variants.find((v) => v.properties.sh !== undefined);
    expect(useVariant).toBeDefined();
    expect(shVariant).toBeDefined();
  });

  it("optionally permits a publish array of named use/sh entries", () => {
    type Variant = {
      properties: {
        name?: { type: string; pattern?: string };
        title?: { type: string };
        use?: { type: string };
        sh?: { type: string };
      };
      required?: string[];
    };
    const schema = workflowJsonSchema() as {
      required: string[];
      properties: {
        publish: {
          type: string;
          items: Variant | { oneOf: Variant[] } | { anyOf: Variant[] };
        };
      };
    };
    expect(schema.required).not.toContain("publish");
    const publish = schema.properties.publish;
    expect(publish.type).toBe("array");
    const items = publish.items;
    const variants = "oneOf" in items ? items.oneOf : "anyOf" in items ? items.anyOf : [items];
    const useVariant = variants.find((v) => v.properties.use !== undefined);
    const shVariant = variants.find((v) => v.properties.sh !== undefined);
    expect(useVariant?.properties.name?.type).toBe("string");
    expect(useVariant?.properties.name?.pattern).toBe("^[a-z0-9-]+$");
    expect(useVariant?.required).toEqual(expect.arrayContaining(["name", "use"]));
    expect(shVariant?.properties.name?.type).toBe("string");
    expect(shVariant?.required).toEqual(expect.arrayContaining(["name", "sh"]));
  });
});
