import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/** Per-server OAuth state persisted to the credential file. */
interface ServerCredentials {
  /** Dynamically-registered OAuth client. */
  clientInformation?: OAuthClientInformationFull;
  /** The OAuth token set (access/refresh). */
  tokens?: OAuthTokens;
  /** PKCE code verifier, held between the authorize redirect and the callback exchange. */
  codeVerifier?: string;
  /** CSRF `state`, held between the authorize redirect and the callback for our own check. */
  state?: string;
}

/** The on-disk credential file: per-server OAuth state, keyed by server name. */
type CredentialsFile = Record<string, ServerCredentials>;

/**
 * A file-backed {@link OAuthClientProvider} for the official MCP SDK, implemented
 * synchronously so callers read results directly. Adds two extensions the routes
 * use: `takeAuthorizationUrl` (the start route captures the URL the SDK produced)
 * and `storedState` (the callback route validates the OAuth `state` itself, since
 * the official `auth()` performs no CSRF check — our `state()` persists it).
 */
export interface KiriOAuthProvider extends OAuthClientProvider {
  get redirectUrl(): string;
  get clientMetadata(): OAuthClientMetadata;
  clientInformation(): OAuthClientInformationFull | undefined;
  saveClientInformation(clientInformation: OAuthClientInformationFull): void;
  tokens(): OAuthTokens | undefined;
  saveTokens(tokens: OAuthTokens): void;
  codeVerifier(): string;
  saveCodeVerifier(codeVerifier: string): void;
  state(): string;
  redirectToAuthorization(authorizationUrl: URL): void;
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void;
  /**
   * The authorization URL recorded by the most recent `redirectToAuthorization`,
   * cleared on read. Undefined when no redirect has been requested.
   */
  takeAuthorizationUrl(): URL | undefined;
  /** The CSRF `state` persisted during the authorize redirect, for the callback to validate against. */
  storedState(): string | undefined;
}

/** Issues file-backed OAuth providers, one per MCP server, sharing a single credential file. */
export interface McpCredentialStore {
  /** An {@link KiriOAuthProvider} for `serverName`, backed by the shared credential file. */
  providerFor(serverName: string): KiriOAuthProvider;
}

/** Read the whole credential file, treating an absent file as empty. */
function readCredentials(filePath: string): CredentialsFile {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, "utf8")) as CredentialsFile;
}

/** Write the credential file, creating its directory and enforcing mode 0600. */
function writeCredentials(filePath: string, data: CredentialsFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  // `mode` on writeFileSync only applies on creation, so chmod each write to keep
  // an already-existing file locked down.
  chmodSync(filePath, 0o600);
}

/** The stored state for one server, or an empty record when none. */
function readServer(filePath: string, name: string): ServerCredentials {
  return readCredentials(filePath)[name] ?? {};
}

/** Merge `patch` into one server's stored state, persisting the file. */
function updateServer(filePath: string, name: string, patch: Partial<ServerCredentials>): void {
  const all = readCredentials(filePath);
  all[name] = { ...(all[name] ?? {}), ...patch };
  writeCredentials(filePath, all);
}

/** Delete one server's entry entirely, or just the named keys when given. */
function clearServer(filePath: string, name: string, keys?: (keyof ServerCredentials)[]): void {
  const all = readCredentials(filePath);
  if (!all[name]) return;
  if (keys) {
    for (const key of keys) delete all[name][key];
  } else {
    delete all[name];
  }
  writeCredentials(filePath, all);
}

/**
 * A file-backed {@link OAuthClientProvider} for one MCP server. Each token,
 * client-registration, PKCE verifier, and CSRF-state read/write hits the shared
 * credential file so the flow survives across the separate auth-start and
 * callback requests; the authorization URL is the only piece held in memory.
 * Registers a public PKCE client (`token_endpoint_auth_method: none`) via dynamic
 * registration.
 */
class FileOAuthProvider implements KiriOAuthProvider {
  private pendingAuthorizationUrl?: URL;

  constructor(
    private readonly filePath: string,
    private readonly serverName: string,
    private readonly redirectBaseUrl: string,
  ) {}

  get redirectUrl(): string {
    return `${this.redirectBaseUrl}/api/mcp/${encodeURIComponent(this.serverName)}/auth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "kiri",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return readServer(this.filePath, this.serverName).clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    updateServer(this.filePath, this.serverName, { clientInformation });
  }

  tokens(): OAuthTokens | undefined {
    return readServer(this.filePath, this.serverName).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    updateServer(this.filePath, this.serverName, { tokens });
  }

  codeVerifier(): string {
    const verifier = readServer(this.filePath, this.serverName).codeVerifier;
    if (verifier === undefined) {
      throw new Error(`no OAuth code verifier stored for MCP server "${this.serverName}"`);
    }
    return verifier;
  }

  saveCodeVerifier(codeVerifier: string): void {
    updateServer(this.filePath, this.serverName, { codeVerifier });
  }

  state(): string {
    // The official auth() puts this in the authorize URL but does not validate it
    // on callback, so persist it for our own CSRF check there.
    const state = crypto.randomUUID();
    updateServer(this.filePath, this.serverName, { state });
    return state;
  }

  storedState(): string | undefined {
    return readServer(this.filePath, this.serverName).state;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all") {
      clearServer(this.filePath, this.serverName);
      return;
    }
    // Discovery metadata isn't persisted (the SDK re-discovers), so nothing to clear.
    if (scope === "discovery") return;
    const key =
      scope === "client" ? "clientInformation" : scope === "tokens" ? "tokens" : "codeVerifier";
    clearServer(this.filePath, this.serverName, [key]);
  }

  takeAuthorizationUrl(): URL | undefined {
    const url = this.pendingAuthorizationUrl;
    this.pendingAuthorizationUrl = undefined;
    return url;
  }
}

/**
 * Create a store of file-backed OAuth providers for MCP servers. Credentials
 * live in the single mode-0600 file at `filePath` (separate from the state DB);
 * `redirectBaseUrl` is the kiri origin the OAuth callback is reached on, e.g.
 * `http://127.0.0.1:4242`.
 */
export function createMcpCredentialStore(
  filePath: string,
  redirectBaseUrl: string,
): McpCredentialStore {
  return {
    providerFor: (serverName) => new FileOAuthProvider(filePath, serverName, redirectBaseUrl),
  };
}
