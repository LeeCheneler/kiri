import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const credentialsSchema = z.object({
  auth_mode: z.literal("chatgpt").optional(),
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().min(1),
  }),
});
const claimsSchema = z.object({ exp: z.number().int().positive() });

/** Credential availability; only a signed-in result contains the bearer token. */
export type CodexAuthState =
  | { status: "signed-in"; accessToken: string; accountId: string; expiresAt: number }
  | { status: "expired"; expiresAt: number }
  | { status: "missing" | "invalid" | "unreadable" };

/**
 * Read Codex's file credentials afresh, without refreshing or writing them.
 * Expiry is Unix milliseconds; JWT claims are inspected, not authenticated.
 * Missing files may also mean Codex uses OS keyring storage instead.
 */
export async function readCodexAuth(
  env: Record<string, string | undefined>,
  now = Date.now(),
): Promise<CodexAuthState> {
  const filePath = join(env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    return {
      status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable",
    };
  }

  // Parsing errors can contain credential text, so expose only a fixed status.
  try {
    const credentials = credentialsSchema.parse(JSON.parse(contents));
    const token = credentials.tokens.access_token;
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return { status: "invalid" };
    const claims = claimsSchema.parse(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
    const expiresAt = claims.exp * 1000;
    if (expiresAt <= now) return { status: "expired", expiresAt };
    return {
      status: "signed-in",
      accessToken: token,
      accountId: credentials.tokens.account_id,
      expiresAt,
    };
  } catch {
    return { status: "invalid" };
  }
}
