import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpCredentialStore } from "./oauth-store.ts";

const REDIRECT_BASE = "http://127.0.0.1:4242";
const CLIENT = { client_id: "abc", redirect_uris: ["http://127.0.0.1:4242/cb"] };
const TOKENS = { access_token: "at", token_type: "Bearer" };

describe("createMcpCredentialStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-creds-"));
    filePath = join(dir, "mcp-credentials.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("derives the callback redirect URL, encoding the server name", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("my server");
    expect(provider.redirectUrl).toBe("http://127.0.0.1:4242/api/mcp/my%20server/auth/callback");
  });

  it("advertises a public PKCE client in its metadata", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    expect(provider.clientMetadata).toEqual({
      client_name: "kiri",
      redirect_uris: ["http://127.0.0.1:4242/api/mcp/linear/auth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("reads back undefined for an untouched server and writes no file", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation()).toBeUndefined();
    expect(provider.storedState()).toBeUndefined();
    expect(existsSync(filePath)).toBe(false);
  });

  it("round-trips client information", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    const info = { ...CLIENT, client_secret: "shh" };
    provider.saveClientInformation(info);
    expect(provider.clientInformation()).toEqual(info);
  });

  it("round-trips tokens", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    const tokens = { ...TOKENS, refresh_token: "rt", expires_in: 3600 };
    provider.saveTokens(tokens);
    expect(provider.tokens()).toEqual(tokens);
  });

  it("round-trips the PKCE code verifier and throws when none is stored", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    expect(() => provider.codeVerifier()).toThrow(/no OAuth code verifier/);
    provider.saveCodeVerifier("verifier-123");
    expect(provider.codeVerifier()).toBe("verifier-123");
  });

  it("generates and persists a fresh CSRF state each call, readable across requests", () => {
    const store = createMcpCredentialStore(filePath, REDIRECT_BASE);
    const a = store.providerFor("linear").state();
    const b = store.providerFor("linear").state();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    // A fresh provider (a later request) reads the last-persisted state.
    expect(store.providerFor("linear").storedState()).toBe(b);
  });

  it("captures the authorization URL once, then clears it", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    expect(provider.takeAuthorizationUrl()).toBeUndefined();
    const url = new URL("https://auth.linear.app/authorize?client_id=abc");
    provider.redirectToAuthorization(url);
    expect(provider.takeAuthorizationUrl()).toEqual(url);
    expect(provider.takeAuthorizationUrl()).toBeUndefined();
  });

  it("invalidates only the tokens for scope 'tokens'", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    provider.saveClientInformation(CLIENT);
    provider.saveTokens(TOKENS);
    provider.invalidateCredentials("tokens");
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation()).toEqual(CLIENT);
  });

  it("invalidates only the client info for scope 'client'", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    provider.saveClientInformation(CLIENT);
    provider.saveTokens(TOKENS);
    provider.invalidateCredentials("client");
    expect(provider.clientInformation()).toBeUndefined();
    expect(provider.tokens()).toEqual(TOKENS);
  });

  it("invalidates only the verifier for scope 'verifier'", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    provider.saveCodeVerifier("v");
    provider.saveTokens(TOKENS);
    provider.invalidateCredentials("verifier");
    expect(() => provider.codeVerifier()).toThrow();
    expect(provider.tokens()).toEqual(TOKENS);
  });

  it("is a no-op for scope 'discovery' (nothing is persisted for it)", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    provider.saveTokens(TOKENS);
    provider.invalidateCredentials("discovery");
    expect(provider.tokens()).toEqual(TOKENS);
  });

  it("drops the whole server entry for scope 'all'", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("linear");
    provider.saveTokens(TOKENS);
    provider.saveClientInformation(CLIENT);
    provider.invalidateCredentials("all");
    expect(provider.tokens()).toBeUndefined();
    expect(provider.clientInformation()).toBeUndefined();
  });

  it("treats invalidating an unknown server as a no-op", () => {
    const provider = createMcpCredentialStore(filePath, REDIRECT_BASE).providerFor("never-seen");
    expect(() => provider.invalidateCredentials("all")).not.toThrow();
  });

  it("keeps each server's credentials isolated in the shared file", () => {
    const store = createMcpCredentialStore(filePath, REDIRECT_BASE);
    store.providerFor("a").saveTokens({ access_token: "a-token", token_type: "Bearer" });
    store.providerFor("b").saveTokens({ access_token: "b-token", token_type: "Bearer" });
    expect(store.providerFor("a").tokens()?.access_token).toBe("a-token");
    expect(store.providerFor("b").tokens()?.access_token).toBe("b-token");
  });

  it("writes the credential file mode 0600, creating a missing parent dir", () => {
    const nested = join(dir, "deep", "mcp-credentials.json");
    const provider = createMcpCredentialStore(nested, REDIRECT_BASE).providerFor("linear");
    provider.saveTokens(TOKENS);
    expect(existsSync(nested)).toBe(true);
    expect(statSync(nested).mode & 0o777).toBe(0o600);
  });
});
