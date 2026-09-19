import { describe, expect, it } from "bun:test";
import { createLlmProviderRegistry } from "./registry.ts";
import type { LlmProvider } from "./schema.ts";

const make = (name: string, type: LlmProvider["type"] = "anthropic"): LlmProvider => ({
  name,
  type,
});

describe("llm provider registry", () => {
  it("starts empty", () => {
    const reg = createLlmProviderRegistry();
    expect(reg.revision()).toBe(0);
    expect(reg.listProviders()).toEqual([]);
    expect(reg.getProvider("missing")).toBeUndefined();
  });

  it("exposes providers put in via replace", () => {
    const reg = createLlmProviderRegistry();
    const a = make("a");
    const b = make("b", "openai");
    reg.replace(
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );

    expect(reg.getProvider("a")).toBe(a);
    expect(reg.getProvider("b")).toBe(b);
    expect(reg.listProviders()).toEqual([a, b]);
  });

  it("advances the revision even when a replacement reuses or empties the provider map", () => {
    const reg = createLlmProviderRegistry();
    const providers = new Map([["a", make("a")]]);
    reg.replace(providers);
    expect(reg.revision()).toBe(1);
    reg.replace(providers);
    expect(reg.revision()).toBe(2);
    reg.replace(new Map());
    expect(reg.revision()).toBe(3);
    expect(reg.listProviders()).toEqual([]);
  });

  it("replace swaps contents wholesale", () => {
    const reg = createLlmProviderRegistry();
    reg.replace(new Map([["a", make("a")]]));

    const c = make("c");
    reg.replace(new Map([["c", c]]));
    expect(reg.getProvider("a")).toBeUndefined();
    expect(reg.listProviders()).toEqual([c]);
  });
});
