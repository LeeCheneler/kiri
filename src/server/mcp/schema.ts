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
