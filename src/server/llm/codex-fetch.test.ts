import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { CODEX_BASE_URL, createCodexFetch } from "./codex-fetch.ts";

const token = (suffix: string, exp = Math.floor(Date.now() / 1000) + 600) =>
  `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.${suffix}`;

describe("Codex authenticated fetch", () => {
  let home: string;
  let file: string;
  let request: ReturnType<typeof createCodexFetch>;
  const save = (accessToken: string, accountId = "account") =>
    writeFile(
      file,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { access_token: accessToken, account_id: accountId },
      }),
    );

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kiri-codex-fetch-"));
    file = join(home, "auth.json");
    request = createCodexFetch({ CODEX_HOME: home, OPENAI_API_KEY: "never-send" }, "chatgpt");
    await save(token("first"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("overwrites auth case-insensitively and reads changed credentials on the next call", async () => {
    const received: { auth: string | null; account: string | null; body: string }[] = [];
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        expect(request.headers.get("originator")).toBe("codex_cli_rs");
        expect(request.headers.get("openai-beta")).toBe("responses=experimental");
        expect(request.headers.get("x-test")).toBe("preserved");
        received.push({
          auth: request.headers.get("authorization"),
          account: request.headers.get("chatgpt-account-id"),
          body: await request.text(),
        });
        return HttpResponse.json({ ok: true });
      }),
    );
    const first = token("first");
    await save(first);
    const makeRequest = () =>
      new Request(`${CODEX_BASE_URL}/responses`, {
        method: "POST",
        headers: { Authorization: "Bearer unused", "x-test": "preserved" },
        body: "prompt",
      });
    await request(makeRequest());
    const second = token("second");
    await save(second, "new-account");
    const contents = await readFile(file, "utf8");
    await request(makeRequest());
    expect(received).toEqual([
      { auth: `Bearer ${first}`, account: "account", body: "prompt" },
      { auth: `Bearer ${second}`, account: "new-account", body: "prompt" },
    ]);
    expect(await readFile(file, "utf8")).toBe(contents);
  });

  it("replays the body once when credentials change during a 401", async () => {
    const second = token("second");
    let calls = 0;
    server.use(
      http.post(`${CODEX_BASE_URL}/responses`, async ({ request }) => {
        expect(await request.text()).toBe("prompt");
        if (++calls === 1) {
          await save(second);
          return new HttpResponse("rejected", { status: 401 });
        }
        expect(request.headers.get("authorization")).toBe(`Bearer ${second}`);
        return HttpResponse.json({ ok: true });
      }),
    );
    expect(
      (await request(`${CODEX_BASE_URL}/responses`, { method: "POST", body: "prompt" })).status,
    ).toBe(200);
    expect(calls).toBe(2);
  });

  it.each([false, true])(
    "stops retrying rejected credentials (replacement: %s)",
    async (replace) => {
      let calls = 0;
      server.use(
        http.get(`${CODEX_BASE_URL}/models`, async () => {
          calls++;
          if (replace) await save(token(`replacement-${calls}`));
          return new HttpResponse("secret backend details", { status: 401 });
        }),
      );
      await expect(request(`${CODEX_BASE_URL}/models`)).rejects.toThrow(
        'provider "chatgpt": Codex authentication was rejected. Run `codex login`, then retry.',
      );
      expect(calls).toBe(replace ? 2 : 1);
    },
  );

  it("recognizes logout during an unauthorized request", async () => {
    server.use(
      http.get(`${CODEX_BASE_URL}/models`, async () => {
        await rm(file);
        return new HttpResponse(null, { status: 401 });
      }),
    );
    await expect(request(`${CODEX_BASE_URL}/models`)).rejects.toThrow(
      "file credentials are missing",
    );
  });

  it("rejects missing and expired credentials before making a request", async () => {
    await save(token("expired", 1));
    await expect(request(`${CODEX_BASE_URL}/responses`)).rejects.toThrow("authentication expired");
    await rm(file);
    await expect(request(`${CODEX_BASE_URL}/responses`)).rejects.toThrow(
      "file credentials are missing",
    );
  });

  it("refuses other origins and paths", async () => {
    await expect(request("https://api.openai.com/v1/responses")).rejects.toThrow(
      "only be sent to the Codex backend",
    );
    await expect(request("https://chatgpt.com/other")).rejects.toThrow(
      "only be sent to the Codex backend",
    );
  });

  it("propagates cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      request(`${CODEX_BASE_URL}/responses`, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });

  it("does not retry rate limits", async () => {
    let calls = 0;
    server.use(
      http.get(`${CODEX_BASE_URL}/models`, () => {
        calls++;
        return new HttpResponse(null, { status: 429 });
      }),
    );
    expect((await request(`${CODEX_BASE_URL}/models`)).status).toBe(429);
    expect(calls).toBe(1);
  });
});
