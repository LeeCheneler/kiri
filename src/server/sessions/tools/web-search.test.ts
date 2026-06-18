import { describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { TAVILY_API_KEY_ENV, createSessionTools, searchTavily, webSearchTool } from "./index.ts";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

// Stub Tavily's search endpoint, capturing the request so the body and auth can
// be asserted. `results` and `images` default to arrays because the SDK maps
// over them unconditionally on a 2xx response.
const stubSearch = (body: Record<string, unknown>) => {
  let request: Request | undefined;
  server.use(
    http.post(TAVILY_SEARCH_URL, async ({ request: req }) => {
      request = req.clone();
      return HttpResponse.json({ results: [], images: [], ...body });
    }),
  );
  return () => request;
};

describe("createSessionTools", () => {
  it("offers web_search when a Tavily key is set", () => {
    const tools = createSessionTools({ [TAVILY_API_KEY_ENV]: "tvly-key" });
    expect(Object.keys(tools)).toEqual(["web_search"]);
  });

  it("offers no tools when the Tavily key is unset", () => {
    expect(createSessionTools({})).toEqual({});
  });

  it("treats a blank Tavily key as unset", () => {
    expect(webSearchTool({ [TAVILY_API_KEY_ENV]: "   " })).toBeNull();
  });
});

describe("searchTavily", () => {
  it("posts the query with bearer auth and returns the answer and results", async () => {
    const capture = stubSearch({
      answer: "Bun is a fast JS runtime.",
      results: [
        { title: "Bun", url: "https://bun.sh", content: "All-in-one toolkit." },
        { title: "Docs", url: "https://bun.sh/docs", content: "Reference." },
      ],
    });

    const output = await searchTavily({ apiKey: "tvly-secret", query: "what is bun" });

    const request = capture();
    expect(request?.headers.get("authorization")).toBe("Bearer tvly-secret");
    expect(await request?.json()).toMatchObject({ query: "what is bun", max_results: 5 });
    expect(output).toEqual({
      query: "what is bun",
      answer: "Bun is a fast JS runtime.",
      results: [
        { title: "Bun", url: "https://bun.sh", content: "All-in-one toolkit." },
        { title: "Docs", url: "https://bun.sh/docs", content: "Reference." },
      ],
    });
  });

  it("drops results with no url and coerces non-string fields", async () => {
    stubSearch({
      results: [
        { title: "Has url", url: "https://example.com", content: "ok" },
        { title: "No url", content: "skip me" },
        { title: 42, url: "https://only-url.com", content: null },
      ],
    });

    const output = await searchTavily({ apiKey: "k", query: "q" });

    expect(output.answer).toBeUndefined();
    expect(output.results).toEqual([
      { title: "Has url", url: "https://example.com", content: "ok" },
      { title: "", url: "https://only-url.com", content: "" },
    ]);
  });

  it("throws without echoing the api key on a non-2xx response", async () => {
    const secret = "tvly-super-secret";
    server.use(
      http.post(
        TAVILY_SEARCH_URL,
        () => new HttpResponse(null, { status: 401, statusText: "Unauthorized" }),
      ),
    );

    let message: string | undefined;
    try {
      await searchTavily({ apiKey: secret, query: "q" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBeDefined();
    expect(message).not.toContain(secret);
  });
});

describe("web_search tool", () => {
  it("runs a search through its execute and returns the parsed output", async () => {
    stubSearch({ results: [{ title: "Result", url: "https://r.com", content: "snippet" }] });
    const tool = createSessionTools({ [TAVILY_API_KEY_ENV]: "k" }).web_search;
    if (!tool?.execute) throw new Error("web_search tool is missing an execute");

    const output = await tool.execute({ query: "hello" }, { toolCallId: "t1", messages: [] });

    expect(output).toEqual({
      query: "hello",
      answer: undefined,
      results: [{ title: "Result", url: "https://r.com", content: "snippet" }],
    });
  });
});
