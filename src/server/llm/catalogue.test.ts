import { describe, expect, it, spyOn } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { createModelCatalogue } from "./catalogue.ts";
import type { LlmProvider } from "./schema.ts";

const openai: LlmProvider = { name: "openai", type: "openai", apiKeyEnv: "OPENAI_API_KEY" };
const local: LlmProvider = {
  name: "local",
  type: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
};

const OPENAI_MODELS = "https://api.openai.com/v1/models";
const LOCAL_MODELS = "http://localhost:1234/v1/models";

// A listing of one model whose context window is `contextWindow`; reporting
// it keeps a custom endpoint from being probed for LM Studio's native listing.
const listing = (contextWindow: number) =>
  HttpResponse.json({ data: [{ id: "model", context_length: contextWindow }] });

const windowOf = (result: { models: { contextWindow?: number }[] }) =>
  result.models[0]?.contextWindow;

// Run `body` against a clock it advances by hand.
const withClock = async (body: (advance: (ms: number) => void) => Promise<void>) => {
  let now = Date.now();
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    await body((ms) => {
      now += ms;
    });
  } finally {
    clock.mockRestore();
  }
};

describe("model catalogue", () => {
  it("shares one discovery between concurrent readers and caches the result", async () => {
    let calls = 0;
    server.use(
      http.get(OPENAI_MODELS, () => {
        calls++;
        return listing(100);
      }),
    );
    const catalogue = createModelCatalogue({});

    const [first, second] = await Promise.all([
      catalogue.listing(openai),
      catalogue.listing(openai),
    ]);

    expect(windowOf(first)).toBe(100);
    expect(second).toBe(first);
    expect(windowOf(await catalogue.listing(openai))).toBe(100);
    expect(calls).toBe(1);
  });

  it("answers for one provider while another's discovery hangs", async () => {
    const release = Promise.withResolvers<void>();
    server.use(
      http.get(LOCAL_MODELS, async () => {
        await release.promise;
        return listing(100);
      }),
      http.get(OPENAI_MODELS, () => listing(200)),
    );
    const catalogue = createModelCatalogue({});
    const hung = catalogue.listing(local);

    expect(windowOf(await catalogue.listing(openai))).toBe(200);

    release.resolve();
    expect(windowOf(await hung)).toBe(100);
  });

  it("reuses a listing for five minutes", async () => {
    await withClock(async (advance) => {
      let calls = 0;
      server.use(http.get(OPENAI_MODELS, () => listing(++calls * 100)));
      const catalogue = createModelCatalogue({});

      expect(windowOf(await catalogue.listing(openai))).toBe(100);
      advance(5 * 60_000 - 1);
      expect(windowOf(await catalogue.listing(openai))).toBe(100);
      advance(1);
      expect(windowOf(await catalogue.listing(openai))).toBe(200);
    });
  });

  it("retries a failed discovery after thirty seconds, not before", async () => {
    await withClock(async (advance) => {
      let calls = 0;
      server.use(
        http.get(OPENAI_MODELS, () =>
          ++calls === 1 ? new HttpResponse(null, { status: 503 }) : listing(100),
        ),
      );
      const catalogue = createModelCatalogue({});

      expect((await catalogue.listing(openai)).reason).toBe("503 Service Unavailable");
      advance(30_000 - 1);
      expect((await catalogue.listing(openai)).reason).toBe("503 Service Unavailable");
      expect(calls).toBe(1);
      advance(1);
      expect(windowOf(await catalogue.listing(openai))).toBe(100);
    });
  });

  it("lets one reader abandon its wait without cancelling the shared discovery", async () => {
    const release = Promise.withResolvers<void>();
    let calls = 0;
    server.use(
      http.get(OPENAI_MODELS, async () => {
        calls++;
        await release.promise;
        return listing(100);
      }),
    );
    const catalogue = createModelCatalogue({});
    const controller = new AbortController();
    const abandoned = catalogue.listing(openai, { signal: controller.signal });
    const patient = catalogue.listing(openai, { signal: new AbortController().signal });

    controller.abort();
    expect(await abandoned).toEqual({ models: [], reason: "discovery wait cancelled" });

    release.resolve();
    expect(windowOf(await patient)).toBe(100);
    expect(calls).toBe(1);
  });

  it("answers at once for a reader whose signal has already fired", async () => {
    server.use(http.get(OPENAI_MODELS, () => listing(100)));
    const catalogue = createModelCatalogue({});

    expect(await catalogue.listing(openai, { signal: AbortSignal.abort() })).toEqual({
      models: [],
      reason: "discovery wait cancelled",
    });
  });

  it("bounds discovery by its timeout", async () => {
    const release = Promise.withResolvers<void>();
    server.use(
      http.get(OPENAI_MODELS, async () => {
        await release.promise;
        return listing(100);
      }),
    );
    const catalogue = createModelCatalogue({}, { timeoutMs: 10 });

    const result = await catalogue.listing(openai);
    release.resolve();

    expect(result.models).toEqual([]);
    expect(result.reason).toBeDefined();
  });

  describe("refresh", () => {
    it("discovers afresh and hands readers the refreshed listing", async () => {
      let calls = 0;
      server.use(http.get(OPENAI_MODELS, () => listing(++calls * 100)));
      const catalogue = createModelCatalogue({});

      expect(windowOf(await catalogue.listing(openai))).toBe(100);
      expect(windowOf(await catalogue.refresh(openai))).toBe(200);
      expect(windowOf(await catalogue.listing(openai))).toBe(200);
      expect(calls).toBe(2);
    });

    it("reports a failed refresh but keeps a fresh successful listing", async () => {
      let calls = 0;
      server.use(
        http.get(OPENAI_MODELS, () =>
          ++calls === 1 ? listing(100) : new HttpResponse(null, { status: 503 }),
        ),
      );
      const catalogue = createModelCatalogue({});
      await catalogue.listing(openai);

      expect((await catalogue.refresh(openai)).reason).toBe("503 Service Unavailable");
      expect(windowOf(await catalogue.listing(openai))).toBe(100);
      expect(calls).toBe(2);
    });

    it("caches a failed refresh when there is no successful listing to keep", async () => {
      let calls = 0;
      server.use(
        http.get(OPENAI_MODELS, () => {
          calls++;
          return new HttpResponse(null, { status: 503 });
        }),
      );
      const catalogue = createModelCatalogue({});

      await catalogue.refresh(openai);
      await catalogue.refresh(openai);
      expect((await catalogue.listing(openai)).reason).toBe("503 Service Unavailable");
      expect(calls).toBe(2);
    });

    it("replaces a successful listing that has gone stale, even with a failure", async () => {
      await withClock(async (advance) => {
        let calls = 0;
        server.use(
          http.get(OPENAI_MODELS, () =>
            ++calls === 1 ? listing(100) : new HttpResponse(null, { status: 503 }),
          ),
        );
        const catalogue = createModelCatalogue({});
        await catalogue.listing(openai);
        advance(5 * 60_000);

        await catalogue.refresh(openai);

        expect((await catalogue.listing(openai)).reason).toBe("503 Service Unavailable");
        expect(calls).toBe(2);
      });
    });

    it("keeps a newer refresh over an older one that settles later", async () => {
      await withClock(async (advance) => {
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        let calls = 0;
        server.use(
          http.get(OPENAI_MODELS, async () => {
            if (++calls === 1) {
              started.resolve();
              await release.promise;
              return listing(100);
            }
            return listing(200);
          }),
        );
        const catalogue = createModelCatalogue({});
        const older = catalogue.refresh(openai);
        await started.promise;
        advance(1);
        await catalogue.refresh(openai);

        release.resolve();
        expect(windowOf(await older)).toBe(100);
        expect(windowOf(await catalogue.listing(openai))).toBe(200);
      });
    });
  });
});
