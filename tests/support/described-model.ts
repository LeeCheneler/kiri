import { type ModelDescription, buildModelDescription } from "../../src/server/llm/index.ts";

/**
 * The description a fake `LlmClients.describeModel` answers for a
 * `provider:model` id: listed with `facts` — text output and no reasoning
 * unless they say otherwise — on an openai-compatible provider named by the
 * id's prefix.
 */
export function describedModel(
  id: string,
  facts: Partial<ModelDescription["model"]> = {},
): ModelDescription {
  const provider = id.slice(0, id.indexOf(":"));
  return buildModelDescription(
    { name: provider, type: "openai-compatible", baseUrl: "http://localhost/v1" },
    id.slice(provider.length + 1),
    { id, provider, output: "text", reasoning: false, ...facts },
  );
}
