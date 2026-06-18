import { describe, expect, it } from "bun:test";
import { TAVILY_API_KEY_ENV, createSessionTools } from "./index.ts";

describe("createSessionTools", () => {
  it("offers the Tavily-backed tools when a key is set", () => {
    const tools = createSessionTools({ [TAVILY_API_KEY_ENV]: "tvly-key" });
    expect(Object.keys(tools)).toEqual(["web_search", "web_extract"]);
  });

  it("offers no tools when the Tavily key is unset", () => {
    expect(createSessionTools({})).toEqual({});
  });
});
