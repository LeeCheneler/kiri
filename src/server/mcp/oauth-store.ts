import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";

/** Per-server OAuth state persisted to the credential file. */
interface ServerCredentials {
  /** Dynamically-registered client (carries the embedded authorization-server info the SDK adds). */
  clientInformation?: OAuthClientInformation;
  /** The OAuth token set (access/refresh), with the SDK's embedded authorization-server info. */
  tokens?: OAuthTokens;
  /** PKCE code verifier, held between the authorize redirect and the callback exchange. */
  codeVerifier?: string;
  /** CSRF `state`, held between the authorize redirect and the callback for comparison. */
  state?: string;
}

/** The on-disk credential file: per-server OAuth state, keyed by server name. */
type CredentialsFile = Record<string, ServerCredentials>;

/**
 * An {@link OAuthClientProvider} whose methods are all implemented synchronously
 * (file-backed), narrowing the SDK's optional/async-or-sync members so callers
 * read results directly. Adds a one-shot reader for the authorization URL the SDK
 * produced — the auth-start route captures it here to redirect the browser.
 */
export interface KiriOAuthProvider extends OAuthClientProvider {
  clientInformation(): OAuthClientInformation | undefined;
  saveClientInformation(clientInformation: OAuthClientInformation): void;
  tokens(): OAuthTokens | undefined;
  saveTokens(tokens: OAuthTokens): void;
  codeVerifier(): string;
  saveCodeVerifier(codeVerifier: string): void;
  state(): string;
  saveState(state: string): void;
  storedState(): string | undefined;
  redirectToAuthorization(authorizationUrl: URL): void;
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void;
  /**
   * The authorization URL recorded by the most recent `redirectToAuthorization`,
   * cleared on read. Undefined when no redirect has been requested.
   */
  takeAuthorizationUrl(): URL | undefined;
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

  clientInformation(): OAuthClientInformation | undefined {
    return readServer(this.filePath, this.serverName).clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformation): void {
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
    return crypto.randomUUID();
  }

  saveState(state: string): void {
    updateServer(this.filePath, this.serverName, { state });
  }

  storedState(): string | undefined {
    return readServer(this.filePath, this.serverName).state;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    if (scope === "all") {
      clearServer(this.filePath, this.serverName);
      return;
    }
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
