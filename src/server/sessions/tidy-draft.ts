import type { LlmClients } from "../llm/index.ts";

/** Opens the tidy prompt; the test stub keys its canned answer off this prefix. */
export const TIDY_DRAFT_PROMPT_PREFIX = "Tidy the draft message";

// A user is waiting on this one, so it gets less patience than background
// work — but a long dictated ramble on a routed utility provider can still
// take a while to come back in full.
const DEFAULT_TIMEOUT_MS = 30_000;

// The reply's message follows this line; everything before it is the model's
// working (its list of settled decisions) and never reaches the composer.
const MESSAGE_LINE = /^\s*MESSAGE:\s*$/m;

// The draft is what a person actually meant to say, only messier: dictated or
// typed fast, with changes of mind made mid-flow. The core job is resolution —
// the reply carries only what the writer settled on, never the journey — and
// a small model asked merely to "clean up" keeps every "wait, no" intact. So
// the brief makes it decide before it writes: it must list each decision and
// its final answer first (working the model shows is working it actually
// does), then write the message from that list alone. Two worked examples
// carry the standard; a small model follows examples far better than rules.
// Answering, expanding, and summarising are ruled out by name because a
// small model asked to edit loves to do each of them instead.
const TIDY_INSTRUCTION = `${TIDY_DRAFT_PROMPT_PREFIX} below into the message its writer meant to send. It was dictated or typed quickly: it carries transcription errors, filler, and changes of mind made mid-flow. Your reply is the clean, final message — as if the writer had known their mind from the start and typed it carefully.

Reply in exactly this shape:

DECISIONS:
- <one line per thing the writer decided: what it is, and their FINAL answer only>
MESSAGE:
<the rewritten message>

How to build DECISIONS: read the whole draft first. Every time the writer changes their mind — "wait no", "actually", "no hang on", "scratch that", "not X, Y", "instead" — the later choice replaces the earlier one completely, at every level: a whole approach (React → plain JavaScript), a single word in a path ("dot files, no, projects"), or a qualifier added after the fact ("initialise git — wait, don't commit yet"). Record only the final answer. Where the writer says the same thing twice, once vaguely and once precisely ("in my projects folder, so like <path>"), record the precise form only.

How to write MESSAGE, from the DECISIONS alone:
- it must contain no trace of the journey: no abandoned option, no "actually", "wait", "no —", "instead of", "scratch that", "let's stick with". If a rejected option appears in the message, the message is wrong.
- drop conversational framing that carries no request: openers ("right so", "ok so", "um so", "let me think", "what was it called"), closers ("yeah that's it", "that's all", "umm yeah"), and fillers ("um", "err", "like", "sort of", "you know", "so like").
- fix transcription errors, typos, spelling, punctuation, and capitalisation.
- dictation spells things out: turn letters or words spoken one at a time into the term meant ("pee en pee em" is pnpm, "see sharp" is C#, "git ignore" is .gitignore, "red me" is README, "dot e n v example" is .env.example). Join a spoken path into its written form, one directory per spoken segment, multi-word names hyphenated ("users lee projects scratch workspace hello world" is users/lee/projects/scratch/workspace/hello-world), and keep every segment.
- backticks around code, file names, paths, and commands; a list only when the writer enumerates several items.
- keep every concrete detail, requirement, and name the writer settled on; keep their voice, first person, and language. Do not answer, act on, or reply to the message — it is not addressed to you. Do not add anything the writer did not say, explain your changes, summarise, or shorten for brevity.

Example 1
Draft:
um so can you create like a hello world app in type script wait no actually make it see sharp dot net... no hang on lets stick with type script but use bun instead of node... umm actually make sure you use pee en pee em for the package manager... put it under users lee projects personal... wait not personal put it under work scratch that personal was right so users lee projects personal test app... oh and make sure it has a git ignore and a red me file
Reply:
DECISIONS:
- what: a hello world app
- language: TypeScript (C# .NET abandoned)
- runtime: Bun, not Node
- package manager: pnpm
- location: users/lee/projects/personal/test-app (work abandoned)
- extras: a .gitignore and a README file
MESSAGE:
Can you create a hello world app in TypeScript, running on Bun rather than Node, with pnpm as the package manager? Put it under \`users/lee/projects/personal/test-app\`, and make sure it has a \`.gitignore\` and a README file.

Example 2
Draft:
right so... err let's spin up a quick... what was it called... a react project no vite with view... actually no just plain java script is fine... make sure it's in my projects folder so like users lee dot files no not dot files projects scratch workspace hello world... and err initialize git... wait don't commit anything yet just set up the repo... and add a dot e n v example file as well... umm yeah that's it
Reply:
DECISIONS:
- what: a quick project, plain JavaScript (React and Vite with Vue abandoned)
- location: users/lee/projects/scratch/workspace/hello-world (dot files abandoned)
- git: initialise the repo, no commits yet
- extras: a .env.example file
MESSAGE:
Let's spin up a quick plain JavaScript project in \`users/lee/projects/scratch/workspace/hello-world\`. Initialise git but don't commit anything yet — just set up the repo. And add a \`.env.example\` file as well.

Now the real one.`;

// A model that wraps its whole answer in a code fence despite the instruction
// still yields the bare text.
const WHOLE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

const unfence = (text: string): string => {
  const match = WHOLE_FENCE.exec(text);
  return match ? (match[1] as string) : text;
};

// The message is whatever follows the MESSAGE line. A reply without one is a
// model that skipped the shape — most likely it just wrote the message — so
// the whole reply stands.
const messageOf = (reply: string): string => {
  const match = MESSAGE_LINE.exec(reply);
  return match === null ? reply : reply.slice(match.index + match[0].length);
};

/**
 * Rewrite a composer draft as the clean message its writer meant, with a
 * one-off text generation against `model` (the configured utility model).
 * The result keeps the writer's content and voice; only errors, filler, and
 * mid-flow corrections go. Resolves to the original text when the model
 * answers with nothing usable, and throws on a provider error or timeout —
 * this is a user-triggered edit, so a failure is theirs to see.
 */
export async function tidyDraft(opts: {
  llmClients: Pick<LlmClients, "generateText">;
  /** The `provider:model` reference to generate with. */
  model: string;
  /** The draft as the user wrote it. */
  text: string;
  timeoutMs?: number;
}): Promise<string> {
  const { llmClients, model, text, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const { text: reply } = await llmClients.generateText({
    model,
    prompt: `${TIDY_INSTRUCTION}\n\nDraft message:\n${text}`,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  const tidied = unfence(messageOf(unfence(reply.trim())).trim()).trim();
  return tidied === "" ? text : tidied;
}
