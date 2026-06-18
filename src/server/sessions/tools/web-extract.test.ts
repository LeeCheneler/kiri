import { describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { TAVILY_API_KEY_ENV, createSessionTools, extractTavily, webExtractTool } from "./index.ts";

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

// Stub Tavily's extract endpoint, capturing the request so the body and auth
// can be asserted. `results` and `failed_results` default to arrays because the
// SDK maps over them unconditionally on a 2xx response.
const stubExtract = (body: Record<string, unknown>) => {
  let request: Request | undefined;
  server.use(
    http.post(TAVILY_EXTRACT_URL, async ({ request: req }) => {
      request = req.clone();
      return HttpResponse.json({ results: [], failed_results: [], ...body });
    }),
  );
  return () => request;
};

describe("extractTavily", () => {
  it("posts the urls with bearer auth and returns extracted content and failures", async () => {
    const capture = stubExtract({
      results: [{ url: "https://bun.sh", raw_content: "# Bun\nAll-in-one toolkit." }],
      failed_results: [{ url: "https://nope.test", error: "Not found" }],
    });

    const output = await extractTavily({
      apiKey: "tvly-secret",
      urls: ["https://bun.sh", "https://nope.test"],
    });

    const request = capture();
    expect(request?.headers.get("authorization")).toBe("Bearer tvly-secret");
    expect(await request?.json()).toMatchObject({
      urls: ["https://bun.sh", "https://nope.test"],
      extract_depth: "basic",
      format: "markdown",
    });
    expect(output).toEqual({
      results: [{ url: "https://bun.sh", content: "# Bun\nAll-in-one toolkit." }],
      failed: [{ url: "https://nope.test", error: "Not found" }],
    });
  });

  it("coerces non-string fields", async () => {
    stubExtract({
      results: [{ url: "https://example.com", raw_content: null }],
      failed_results: [{ url: 42, error: null }],
    });

    const output = await extractTavily({ apiKey: "k", urls: ["https://example.com"] });

    expect(output).toEqual({
      results: [{ url: "https://example.com", content: "" }],
      failed: [{ url: "", error: "" }],
    });
  });

  it("throws without echoing the api key on a non-2xx response", async () => {
    const secret = "tvly-super-secret";
    server.use(
      http.post(
        TAVILY_EXTRACT_URL,
        () => new HttpResponse(null, { status: 401, statusText: "Unauthorized" }),
      ),
    );

    let message: string | undefined;
    try {
      await extractTavily({ apiKey: secret, urls: ["https://x.com"] });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBeDefined();
    expect(message).not.toContain(secret);
  });
});

describe("web_extract tool", () => {
  it("is null when the Tavily key is blank", () => {
    expect(webExtractTool({ [TAVILY_API_KEY_ENV]: "   " })).toBeNull();
  });

  it("runs an extract through its execute and returns the parsed output", async () => {
    stubExtract({ results: [{ url: "https://r.com", raw_content: "deep content" }] });
    const tool = createSessionTools({ [TAVILY_API_KEY_ENV]: "k" }).web_extract;
    if (!tool?.execute) throw new Error("web_extract tool is missing an execute");

    const output = await tool.execute(
      { urls: ["https://r.com"] },
      { toolCallId: "t1", messages: [] },
    );

    expect(output).toEqual({
      results: [{ url: "https://r.com", content: "deep content" }],
      failed: [],
    });
  });
});
