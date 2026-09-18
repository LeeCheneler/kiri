import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigSnapshot } from "../config/service.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type KiriEvent, createEventBus } from "../events/index.ts";
import { createSession, getSession } from "./store.ts";
import {
  defaultWorkingDirectory,
  prepareWorkingDirectory,
  sandboxOf,
  staleCwdReason,
} from "./working-directory.ts";

const MODEL = "test:model";

const snapshotWith = (filesystem: ConfigSnapshot["filesystem"]): ConfigSnapshot => ({
  revision: 1,
  providers: new Map(),
  mcp: new Map(),
  models: { shortcuts: {}, delegates: {} },
  filesystem,
  diagnostics: { mcpUnresolved: [] },
});

describe("session working directory", () => {
  let root: string;
  let db: KiriDb;

  beforeEach(() => {
    // Resolved, so paths compare equal to what the policy resolves them to.
    root = realpathSync(mkdtempSync(join(tmpdir(), "kiri-cwd-")));
    db = openDatabase(join(root, "state.db"));
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("confines the sandbox and the default to directories that exist", () => {
    const snapshot = snapshotWith({
      allowedDirectories: [root, join(root, "missing")],
      defaultWorkingDirectory: join(root, "missing"),
    });

    expect(sandboxOf(snapshot)).toEqual([root]);
    expect(defaultWorkingDirectory(snapshot)).toBeUndefined();
    expect(
      defaultWorkingDirectory(
        snapshotWith({ allowedDirectories: [root], defaultWorkingDirectory: root }),
      ),
    ).toBe(root);
    expect(defaultWorkingDirectory(snapshotWith({ allowedDirectories: [root] }))).toBeUndefined();
  });

  describe("staleCwdReason", () => {
    it("accepts a directory at or beneath a sandbox root", () => {
      mkdirSync(join(root, "inner"));

      expect(staleCwdReason(root, [root])).toBeNull();
      expect(staleCwdReason(join(root, "inner"), [root])).toBeNull();
    });

    it("names a directory that left the disk", () => {
      expect(staleCwdReason(join(root, "gone"), [root])).toBe(
        `The session's working directory "${join(root, "gone")}" no longer exists.`,
      );
    });

    it("names a directory outside every sandbox root, a sibling sharing a prefix included", () => {
      mkdirSync(join(root, "inner"));
      mkdirSync(join(root, "inner-sibling"));

      expect(staleCwdReason(root, [join(root, "inner")])).toBe(
        `The session's working directory "${root}" is outside the allowed directories.`,
      );
      expect(staleCwdReason(join(root, "inner-sibling"), [join(root, "inner")])).not.toBeNull();
    });

    it("stands down when no sandbox root is usable", () => {
      // With no sandbox the filesystem and shell tools are withheld outright,
      // so a stale directory can't misdirect anything.
      expect(staleCwdReason(join(root, "gone"), [])).toBeNull();
      expect(staleCwdReason(join(root, "gone"), [join(root, "missing")])).toBeNull();
    });
  });

  describe("prepareWorkingDirectory", () => {
    const prepare = (snapshot: ConfigSnapshot, cwd?: string) => {
      const events: KiriEvent[] = [];
      const bus = createEventBus();
      bus.subscribe((event) => events.push(event));
      const session = createSession(db, MODEL, { id: "s1", ...(cwd ? { cwd } : {}) });
      return { ...prepareWorkingDirectory({ db, bus }, snapshot, session), events };
    };

    it("leaves a usable working directory untouched and says nothing", () => {
      const snapshot = snapshotWith({ allowedDirectories: [root], defaultWorkingDirectory: root });
      mkdirSync(join(root, "inner"));

      const { session, notice, events } = prepare(snapshot, join(root, "inner"));

      expect(session.cwd).toBe(join(root, "inner"));
      expect(notice).toBeUndefined();
      expect(events).toEqual([]);
    });

    it("moves a stale directory to the default, publishing and explaining the move", () => {
      const snapshot = snapshotWith({ allowedDirectories: [root], defaultWorkingDirectory: root });

      const { session, notice, events } = prepare(snapshot, join(root, "gone"));

      expect(session.cwd).toBe(root);
      expect(getSession(db, "s1")?.cwd).toBe(root);
      expect(notice).toContain(`"${join(root, "gone")}" no longer exists`);
      expect(notice).toContain(`moved to the configured default working directory, "${root}"`);
      expect(events).toEqual([{ type: "session.updated", id: "s1", status: "idle" }]);
    });

    it("clears a stale directory outright when no usable default exists", () => {
      const snapshot = snapshotWith({
        allowedDirectories: [root],
        defaultWorkingDirectory: join(root, "missing-default"),
      });

      const { session, notice } = prepare(snapshot, join(root, "gone"));

      expect(session.cwd).toBeNull();
      expect(getSession(db, "s1")?.cwd).toBeNull();
      expect(notice).toContain("the session now has none");
    });

    it("heals a directory a config edit moved the sandbox out from under", () => {
      mkdirSync(join(root, "inner"));
      const snapshot = snapshotWith({
        allowedDirectories: [join(root, "inner")],
        defaultWorkingDirectory: join(root, "inner"),
      });

      const { session, notice } = prepare(snapshot, root);

      expect(session.cwd).toBe(join(root, "inner"));
      expect(notice).toContain(`"${root}" is outside the allowed directories`);
    });

    it("gives a session without a directory the default, silently", () => {
      const snapshot = snapshotWith({ allowedDirectories: [root], defaultWorkingDirectory: root });

      const { session, notice, events } = prepare(snapshot);

      expect(session.cwd).toBe(root);
      expect(notice).toBeUndefined();
      expect(events).toEqual([]);
    });

    it("leaves a session without a directory alone when no default exists", () => {
      const { session, notice } = prepare(snapshotWith({ allowedDirectories: [root] }));

      expect(session.cwd).toBeNull();
      expect(notice).toBeUndefined();
    });

    it("leaves a stale directory in place when no sandbox is declared", () => {
      const { session, notice } = prepare(
        snapshotWith({ allowedDirectories: [] }),
        join(root, "gone"),
      );

      expect(session.cwd).toBe(join(root, "gone"));
      expect(notice).toBeUndefined();
    });
  });
});
