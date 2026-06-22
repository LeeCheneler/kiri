import { z } from "zod";
import { envRefSchema } from "../config/env-ref.ts";

const stdioServerSchema = z
  .object({
    type: z.literal("stdio"),
    command: z.string().min(1).describe("Executable to spawn for the MCP server, e.g. `npx`."),
    args: z.array(z.string()).optional().describe("Arguments passed to `command`."),
    env: z
      .record(z.string().min(1), envRefSchema)
      .optional()
      .describe(
        "Environment variables for the spawned process. Each value is an { env: <NAME> } ref so secrets stay out of git.",
      ),
  })
  .strict();

const httpServerSchema = z
  .object({
    type: z.literal("http"),
    url: z.string().min(1).describe("URL of the remote MCP server (Streamable HTTP)."),
    headers: z
      .record(z.string().min(1), envRefSchema)
      .optional()
      .describe(
        "Static request headers, e.g. Authorization. Each value is an { env: <NAME> } ref so secrets stay out of git.",
      ),
    auth: z
      .literal("oauth")
      .optional()
      .describe(
        "Authenticate via OAuth instead of (or alongside) static headers. Kiri runs the OAuth sign-in in the browser and manages the tokens in .kiri/ (mode 0600); no { env: } ref is needed for the Authorization header.",
      ),
  })
  .strict();

/**
 * A single MCP server entry, discriminated on `type`: `stdio` spawns a local
 * subprocess kiri talks to over stdio; `http` connects to a remote
 * Streamable-HTTP server. `type` is always required so the published JSON
 * Schema can surface every per-type rule as an editor error.
 */
const mcpServerEntrySchema = z.discriminatedUnion("type", [stdioServerSchema, httpServerSchema]);

/** Schema for the `mcp:` map in `kiri.yaml`, keyed by server name. */
export const mcpServersSchema = z
  .record(z.string().min(1), mcpServerEntrySchema)
  .describe("MCP servers whose tools are offered to agentic sessions, keyed by name.");

/** A single validated MCP server entry. */
export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;

/** An MCP server transport type. */
export type McpServerType = McpServerEntry["type"];

/**
 * A resolved stdio MCP server: its command plus the *names* of the environment
 * variables its process env is read from (values are read at connect time and
 * never stored).
 */
export interface McpStdioServer {
  name: string;
  type: "stdio";
  command: string;
  args?: string[];
  /** Child process env var name → source environment variable name. */
  envRefs?: Record<string, string>;
}

/**
 * A resolved http MCP server: its URL plus the *names* of the environment
 * variables its request headers are read from (values are read at connect time
 * and never stored).
 */
export interface McpHttpServer {
  name: string;
  type: "http";
  url: string;
  /** Header name → source environment variable name. */
  headerRefs?: Record<string, string>;
  /**
   * When true, kiri authenticates to this server via OAuth, managing its tokens
   * in the credential store rather than reading a static Authorization header.
   */
  oauth?: boolean;
}

/** A resolved MCP server, keyed by name in the loaded config. */
export type McpServer = McpStdioServer | McpHttpServer;

/**
 * An MCP server excluded from the loaded config because a declared env ref
 * names a variable that is unset, so the server can't be used until it's set.
 */
export interface McpServerUnresolved {
  name: string;
  /** Names of the referenced environment variables that are unset. */
  missing: string[];
}
