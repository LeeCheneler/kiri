import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexAuth } from "./codex-auth.ts";

const directories: string[] = [];
const now = 1_800_000_000_000;
const jwt = (claims: unknown) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const credential = (token = jwt({ exp: now / 1000 + 60 })) => ({
  auth_mode: "chatgpt",
  tokens: { access_token: token, account_id: "account", refresh_token: "never-use-this" },
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kiri-codex-auth-"));
  directories.push(directory);
  return { env: { CODEX_HOME: directory }, file: join(directory, "auth.json") };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("readCodexAuth", () => {
  test("reads credentials without modifying them and sees replacement and removal", async () => {
    const { env, file } = await fixture();
    const original = JSON.stringify(credential());
    await writeFile(file, original);
    expect(await readCodexAuth(env, now)).toEqual({
      status: "signed-in",
      accessToken: credential().tokens.access_token,
      accountId: "account",
      expiresAt: now + 60_000,
    });
    expect(await readFile(file, "utf8")).toBe(original);
    await writeFile(file, JSON.stringify(credential(jwt({ exp: now / 1000 }))));
    expect(await readCodexAuth(env, now)).toEqual({ status: "expired", expiresAt: now });
    await rm(file);
    expect(await readCodexAuth(env, now)).toEqual({ status: "missing" });
  });

  test("supports older file layouts without auth_mode or refresh tokens", async () => {
    const { env, file } = await fixture();
    await writeFile(
      file,
      JSON.stringify({
        tokens: { access_token: jwt({ exp: now / 1000 + 60 }), account_id: "account" },
      }),
    );
    expect((await readCodexAuth(env, now)).status).toBe("signed-in");
  });

  test.each([
    "not-json-secret",
    "null",
    "{}",
    JSON.stringify({ ...credential(), auth_mode: "apikey" }),
    JSON.stringify({ tokens: { access_token: jwt({ exp: now / 1000 + 60 }) } }),
    ...["bad-token", "a..c", "a.invalid.c", jwt({}), jwt({ exp: "future" }), jwt({ exp: -1 })].map(
      (token) => JSON.stringify(credential(token)),
    ),
  ])("rejects malformed credentials without exposing their contents (%#)", async (contents) => {
    const { env, file } = await fixture();
    await writeFile(file, contents);
    expect(await readCodexAuth(env, now)).toEqual({ status: "invalid" });
  });

  test("distinguishes unavailable files from missing login", async () => {
    const { env, file } = await fixture();
    await mkdir(file);
    expect(await readCodexAuth(env, now)).toEqual({ status: "unreadable" });
  });
});
