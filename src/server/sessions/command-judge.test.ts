import { describe, expect, it } from "bun:test";
import type { LlmClients } from "../llm/index.ts";
import { judgeCommand } from "./command-judge.ts";

const fakeClients = (
  respond: (options: { model: string; prompt: string; abortSignal?: AbortSignal }) => string,
): Pick<LlmClients, "generateText"> => ({
  generateText: async (options) => ({ text: respond(options), usage: {} }),
});

const judge = (text: string) =>
  judgeCommand({
    llmClients: fakeClients(() => text),
    model: "openai:gpt-mini",
    command: "git pull",
    cwd: "/repo",
  });

describe("judgeCommand", () => {
  it("allows on a well-formed allow verdict, carrying the reason", async () => {
    const result = await judge(
      "EFFECTS: fetches and merges the remote branch\nVERDICT: allow\nREASON: routine git pull",
    );
    expect(result).toEqual({ verdict: "allow", reason: "routine git pull" });
  });

  it("asks on a well-formed ask verdict", async () => {
    const result = await judge(
      "EFFECTS: deletes the build directory\nVERDICT: ask\nREASON: destructive delete",
    );
    expect(result).toEqual({ verdict: "ask", reason: "destructive delete" });
  });

  it("parses verdict and reason case- and whitespace-tolerantly", async () => {
    const result = await judge("Effects: reads files\n  Verdict:  ALLOW  \n  reason: read-only");
    expect(result).toEqual({ verdict: "allow", reason: "read-only" });
  });

  it("falls back to a placeholder reason when the reason line is missing", async () => {
    const result = await judge("VERDICT: allow");
    expect(result).toEqual({ verdict: "allow", reason: "no reason given" });
  });

  it("asks when no verdict line is present", async () => {
    const result = await judge("This command looks fine to me, go ahead!");
    expect(result).toEqual({ verdict: "ask", reason: "safety judgement was unreadable" });
  });

  it("asks when the verdict value is neither allow nor ask", async () => {
    const result = await judge("VERDICT: maybe\nREASON: unsure");
    expect(result).toEqual({ verdict: "ask", reason: "safety judgement was unreadable" });
  });

  it("does not treat an allow buried in prose as a verdict line", async () => {
    const result = await judge("I would allow this.\nVERDICT: ask\nREASON: unsure");
    expect(result).toEqual({ verdict: "ask", reason: "unsure" });
  });

  it("asks when the model call rejects", async () => {
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: async () => {
        throw new Error("provider down");
      },
    };
    const result = await judgeCommand({
      llmClients: clients,
      model: "openai:gpt-mini",
      command: "git pull",
      cwd: "/repo",
    });
    expect(result).toEqual({
      verdict: "ask",
      reason: "safety judgement unavailable: provider down",
    });
  });

  it("asks when the judgement exceeds its timeout", async () => {
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    };
    const result = await judgeCommand({
      llmClients: clients,
      model: "openai:gpt-mini",
      command: "git pull",
      cwd: "/repo",
      timeoutMs: 5,
    });
    expect(result.verdict).toBe("ask");
    expect(result.reason).toStartWith("safety judgement unavailable:");
  });

  it("asks without calling the model for an over-long command", async () => {
    let called = false;
    const clients = fakeClients(() => {
      called = true;
      return "VERDICT: allow";
    });
    const result = await judgeCommand({
      llmClients: clients,
      model: "openai:gpt-mini",
      command: `echo ${"x".repeat(5000)}`,
      cwd: "/repo",
    });
    expect(result).toEqual({ verdict: "ask", reason: "command is too long to judge" });
    expect(called).toBe(false);
  });

  it("sends the command and working directory to the model", async () => {
    let prompt = "";
    const clients = fakeClients((options) => {
      prompt = options.prompt;
      return "VERDICT: ask\nREASON: unsure";
    });
    await judgeCommand({
      llmClients: clients,
      model: "openai:gpt-mini",
      command: "bun install",
      cwd: "/repo/worktree",
    });
    expect(prompt).toContain("Command:\nbun install");
    expect(prompt).toContain("Working directory: /repo/worktree");
  });
});
