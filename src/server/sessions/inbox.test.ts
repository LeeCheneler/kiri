import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelMessage, UIMessage } from "ai";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import {
  type InboxDelivery,
  type InboxItem,
  deleteInboxItems,
  enqueueInboxItem,
  expandInboxMessages,
  inboxUIPart,
  insertInboxModelMessages,
  pendingInboxItems,
} from "./inbox.ts";
import { createSession, deleteSession } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// A queued item without a database, for the pure helpers.
const item = (
  id: string,
  text: string,
  sender: { source?: InboxItem["source"]; fromSessionId?: string | null } = {},
): InboxItem => ({
  id,
  sessionId: "s1",
  source: sender.source ?? "user",
  text,
  fromSessionId: sender.fromSessionId ?? null,
  createdAt: new Date(1_000),
});

const delivery = (id: string, insertIndex: number): InboxDelivery => ({
  item: item(id, `msg ${id}`),
  insertIndex,
});

const user = (text: string): ModelMessage => ({ role: "user", content: text });
const assistant = (text: string): ModelMessage => ({ role: "assistant", content: text });

describe("inbox store", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-inbox-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("queues, lists in FIFO order, and deletes", () => {
    createSession(db, MODEL, { id: "s1" });
    const first = enqueueInboxItem(db, "s1", { source: "user", text: "first" });
    const second = enqueueInboxItem(db, "s1", { source: "user", text: "second" });

    // Same-millisecond enqueues keep insertion order (rowid breaks the tie).
    expect(pendingInboxItems(db, "s1").map((row) => row.text)).toEqual(["first", "second"]);
    expect(first.createdAt).toBeInstanceOf(Date);

    deleteInboxItems(db, [first.id]);
    expect(pendingInboxItems(db, "s1").map((row) => row.id)).toEqual([second.id]);
    // An empty delete is a no-op rather than a malformed query.
    deleteInboxItems(db, []);
    expect(pendingInboxItems(db, "s1")).toHaveLength(1);
  });

  it("stores a child sender's session id and carries it into the delivered part", () => {
    createSession(db, MODEL, { id: "s1" });
    const fromChild = enqueueInboxItem(db, "s1", {
      source: "child",
      fromSessionId: "worker-1",
      text: "report",
    });
    const fromUser = enqueueInboxItem(db, "s1", { source: "user", text: "steer" });

    expect(fromChild.fromSessionId).toBe("worker-1");
    expect(inboxUIPart(fromChild).data).toEqual({
      source: "child",
      text: "report",
      fromSessionId: "worker-1",
      queuedAt: fromChild.createdAt.getTime(),
    });
    // A sender-less item leaves the key off the part rather than nulling it.
    expect(fromUser.fromSessionId).toBeNull();
    expect("fromSessionId" in inboxUIPart(fromUser).data).toBe(false);
  });

  it("scopes the backlog to its session", () => {
    createSession(db, MODEL, { id: "s1" });
    createSession(db, MODEL, { id: "s2" });
    enqueueInboxItem(db, "s1", { source: "user", text: "for s1" });

    expect(pendingInboxItems(db, "s2")).toEqual([]);
  });

  it("deletes a session's backlog with the session", () => {
    createSession(db, MODEL, { id: "s1" });
    enqueueInboxItem(db, "s1", { source: "user", text: "queued" });

    deleteSession(db, "s1");

    expect(pendingInboxItems(db, "s1")).toEqual([]);
  });
});

describe("insertInboxModelMessages", () => {
  it("inserts each delivery at its recorded position, keeping queue order on ties", () => {
    const messages = [user("hi"), assistant("working"), assistant("more")];

    const out = insertInboxModelMessages(messages, [
      delivery("a", 2),
      delivery("b", 2),
      delivery("c", 3),
    ]);

    expect(out.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "user",
      "assistant",
      "user",
    ]);
    expect(JSON.stringify(out[2]?.content)).toContain("msg a");
    expect(JSON.stringify(out[3]?.content)).toContain("msg b");
    expect(JSON.stringify(out[5]?.content)).toContain("msg c");
    // The framed text names the mid-turn arrival and carries the raw message.
    expect(JSON.stringify(out[2]?.content)).toContain("while you were working");
  });

  it("clamps a position past the end rather than dropping the delivery", () => {
    const out = insertInboxModelMessages([user("hi")], [delivery("a", 9)]);

    expect(out.map((m) => m.role)).toEqual(["user", "user"]);
  });
});

describe("expandInboxMessages", () => {
  const message = (role: UIMessage["role"], parts: UIMessage["parts"]): UIMessage => ({
    id: "m1",
    role,
    parts,
  });

  it("passes messages without inbox parts through untouched", () => {
    const plain = message("assistant", [{ type: "text", text: "hi" }]);
    expect(expandInboxMessages([plain])).toEqual([plain]);
  });

  it("turns a drained user row into framed text", () => {
    const drained = message("user", [
      inboxUIPart(item("a", "queued while idle")) as UIMessage["parts"][number],
    ]);

    const [out] = expandInboxMessages([drained]);

    expect(out?.role).toBe("user");
    const text = (out?.parts[0] as { text: string }).text;
    expect(text).toContain("queued while idle");
    expect(text).toContain("while no turn was running");
  });

  it("leaves a drained row's non-inbox parts untouched", () => {
    const mixed = message("user", [
      { type: "text", text: "typed directly" },
      inboxUIPart(item("a", "queued")) as UIMessage["parts"][number],
    ]);

    const [out] = expandInboxMessages([mixed]);

    expect(out?.parts).toHaveLength(2);
    expect((out?.parts[0] as { text: string }).text).toBe("typed directly");
    expect((out?.parts[1] as { text: string }).text).toContain("queued");
  });

  it("splits an assistant message into slices around each woven delivery", () => {
    const woven = message("assistant", [
      { type: "step-start" },
      { type: "text", text: "before" },
      inboxUIPart(item("a", "interjection")) as UIMessage["parts"][number],
      { type: "step-start" },
      { type: "text", text: "after" },
    ]);

    const out = expandInboxMessages([woven]);

    expect(out.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect((out[0]?.parts[1] as { text: string }).text).toBe("before");
    const framedText = (out[1]?.parts[0] as { text: string }).text;
    expect(framedText).toContain("interjection");
    expect(framedText).toContain("while you were working");
    expect((out[2]?.parts[1] as { text: string }).text).toBe("after");
  });

  it("emits no empty slice for a leading or trailing delivery", () => {
    const woven = message("assistant", [
      inboxUIPart(item("a", "leading")) as UIMessage["parts"][number],
      { type: "text", text: "answer" },
      inboxUIPart(item("b", "trailing")) as UIMessage["parts"][number],
    ]);

    const out = expandInboxMessages([woven]);

    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("sender framing", () => {
  // Resolves the one known worker, standing in for the live title lookup the
  // turn supplies.
  const labelFor = (id: string): string | undefined => (id === "w1" ? "CVE scan" : undefined);

  const framedTextOf = (sender: Parameters<typeof item>[2]): string => {
    const drained = {
      id: "m1",
      role: "user" as const,
      parts: [inboxUIPart(item("a", "the message", sender)) as UIMessage["parts"][number]],
    };
    const [out] = expandInboxMessages([drained], labelFor);
    return (out?.parts[0] as { text: string }).text;
  };

  it("names the user as the sender by default", () => {
    expect(framedTextOf({})).toContain("The user sent this message");
  });

  it("names the parent session as the sender of a parent-sourced message", () => {
    const text = framedTextOf({ source: "parent" });
    expect(text).toContain("The session that delegated your task sent this message");
    expect(text).toContain("the message");
  });

  it("names a child sender by its resolved live label", () => {
    const text = framedTextOf({ source: "child", fromSessionId: "w1" });
    expect(text).toContain('Your delegated worker "CVE scan" sent this message');
  });

  it("drops the name when the sender no longer resolves, rather than quoting nothing", () => {
    const text = framedTextOf({ source: "child", fromSessionId: "deleted" });
    expect(text).toContain("Your delegated worker sent this message");
    expect(text).not.toContain('""');
  });

  it("drops the name without a resolver at all", () => {
    const drained = {
      id: "m1",
      role: "user" as const,
      parts: [
        inboxUIPart(
          item("a", "the message", { source: "child", fromSessionId: "w1" }),
        ) as UIMessage["parts"][number],
      ],
    };
    const [out] = expandInboxMessages([drained]);
    expect((out?.parts[0] as { text: string }).text).toContain(
      "Your delegated worker sent this message",
    );
  });

  it("frames the sender on mid-turn weaves too", () => {
    const woven = {
      id: "m1",
      role: "assistant" as const,
      parts: [
        { type: "text", text: "before" } as const,
        inboxUIPart(
          item("a", "steer", { source: "parent" }),
        ) as unknown as UIMessage["parts"][number],
      ],
    };
    const out = expandInboxMessages([woven], labelFor);
    const framedText = (out[1]?.parts[0] as { text: string }).text;
    expect(framedText).toContain("The session that delegated your task sent this message");
    expect(framedText).toContain("while you were working");
  });
});
