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

  it("optionally permits an inputs array of named input declarations", () => {
    type Item = {
      type: string;
      required?: string[];
      properties: {
        name?: { type: string; pattern?: string };
        description?: { type: string };
        required?: { type: string };
        default?: { type: string };
        options?: {
          type: string;
          minItems?: number;
          items?: { type: string; minLength?: number };
        };
      };
    };
    const schema = workflowJsonSchema() as {
      required: string[];
      properties: {
        inputs: {
          type: string;
          minItems?: number;
          items: Item;
        };
      };
    };
    expect(schema.required).not.toContain("inputs");
    const inputs = schema.properties.inputs;
    expect(inputs.type).toBe("array");
    expect(inputs.minItems).toBe(1);
    expect(inputs.items.type).toBe("object");
    expect(inputs.items.required).toEqual(expect.arrayContaining(["name"]));
    expect(inputs.items.required).not.toContain("options");
    expect(inputs.items.properties.name?.type).toBe("string");
    expect(inputs.items.properties.name?.pattern).toBe("^[a-z_][a-z0-9_]*$");
    expect(inputs.items.properties.description?.type).toBe("string");
    expect(inputs.items.properties.required?.type).toBe("boolean");
    expect(inputs.items.properties.default?.type).toBe("string");
    expect(inputs.items.properties.options?.type).toBe("array");
    expect(inputs.items.properties.options?.minItems).toBe(1);
    expect(inputs.items.properties.options?.items?.type).toBe("string");
  });

  it("step env values accept a string or a structured input reference", () => {
    type EnvBranch =
      | { type: "string" }
      | {
          type: "object";
          properties: { input?: { type: string; minLength?: number } };
          required?: string[];
          additionalProperties?: false;
        };
    type StepVariant = {
      properties: {
        env?: {
          type: string;
          additionalProperties: { anyOf: EnvBranch[] };
        };
      };
    };
    const schema = workflowJsonSchema() as {
      properties: {
        steps: {
          items: StepVariant | { oneOf: StepVariant[] } | { anyOf: StepVariant[] };
        };
      };
    };
    const items = schema.properties.steps.items;
    const variants = "oneOf" in items ? items.oneOf : "anyOf" in items ? items.anyOf : [items];
    const useVariant = variants.find((v) => v.properties.env !== undefined);
    expect(useVariant?.properties.env?.type).toBe("object");
    const branches = useVariant?.properties.env?.additionalProperties.anyOf ?? [];
    const stringBranch = branches.find((b) => b.type === "string");
    const refBranch = branches.find(
      (b): b is Extract<EnvBranch, { type: "object" }> => b.type === "object",
    );
    expect(stringBranch).toBeDefined();
    expect(refBranch).toBeDefined();
    expect(refBranch?.properties.input?.type).toBe("string");
    expect(refBranch?.required).toEqual(expect.arrayContaining(["input"]));
    expect(refBranch?.additionalProperties).toBe(false);
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
