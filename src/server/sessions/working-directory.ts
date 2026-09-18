import { existsSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import type { ConfigSnapshot } from "../config/service.ts";
import type { KiriDb } from "../db/index.ts";
import { type Session, updateSessionCwd } from "./store.ts";

/**
 * A snapshot's filesystem sandbox, filtered to directories that exist: a
 * declared entry that isn't on disk can't be browsed, and offering tools (or
 * advertising a root) that every call would then reject reads as broken —
 * with nothing usable, the tools are withheld outright.
 */
export function sandboxOf(snapshot: ConfigSnapshot): readonly string[] {
  return snapshot.filesystem.allowedDirectories.filter((dir) => existsSync(dir));
}

/**
 * Where a new session starts working, on the same must-exist posture: a
 * configured default that isn't on disk yields a session with no working
 * directory rather than one pointing somewhere unusable.
 */
export function defaultWorkingDirectory(snapshot: ConfigSnapshot): string | undefined {
  const dir = snapshot.filesystem.defaultWorkingDirectory;
  return dir !== undefined && existsSync(dir) ? dir : undefined;
}

/**
 * Why a session's stored working directory can no longer be used — it left
 * the disk, or a kiri.yaml edit moved the sandbox out from under it — or null
 * while it remains valid. With an empty sandbox the check stands down: the
 * filesystem and shell tools are withheld outright then, so a stale value
 * can't send any work astray, and a plain chat shouldn't be blocked by config
 * it no longer uses.
 */
export function staleCwdReason(cwd: string, sandbox: readonly string[]): string | null {
  const roots: string[] = [];
  for (const dir of sandbox) {
    try {
      roots.push(realpathSync(dir));
    } catch {
      // Skipped: a declared directory that doesn't exist.
    }
  }
  if (roots.length === 0) return null;
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    return `The session's working directory "${cwd}" no longer exists.`;
  }
  if (!roots.some((dir) => real === dir || real.startsWith(dir + sep))) {
    return `The session's working directory "${cwd}" is outside the allowed directories.`;
  }
  return null;
}

/**
 * What the model must hear when a turn heals a stale working directory: why
 * the old one is unusable, where the session now runs (or that it has nowhere
 * until one is set), and that the user should be told — the move happened out
 * from under the conversation, so the model is the one who announces it.
 */
export function cwdMoveNotice(reason: string, healed: string | null): string {
  return healed !== null
    ? `${reason} The session has been moved to the configured default working directory, "${healed}" — relative paths and commands now resolve there. Tell the user about the move before doing filesystem or shell work; if that isn't the right place, move with set_working_directory or have them update kiri.yaml.`
    : `${reason} No usable default working directory is configured, so the session now has none — relative paths are rejected until one is set. Tell the user, and either move with set_working_directory or have them set filesystem.default_working_directory in kiri.yaml.`;
}

// Give a session with no working directory — created before a default
// existed, or whose stale directory was just cleared — the snapshot's default,
// so it picks one up the moment one becomes usable. A session that has a
// directory is returned untouched: a *stale* one is never swapped silently.
function healMissingCwd(db: KiriDb, snapshot: ConfigSnapshot, session: Session): Session {
  if (session.cwd !== null) return session;
  const dir = defaultWorkingDirectory(snapshot);
  return dir === undefined ? session : updateSessionCwd(db, session.id, dir);
}

/**
 * Make a session's working directory usable before its turn runs. A stale
 * one — gone from disk (a deleted worktree), or moved outside the sandbox by
 * a kiri.yaml edit — heals rather than failing the turn: the session falls
 * back to the configured default (or to none when no usable default exists),
 * and the returned `notice` is what this turn's prompt must say about the
 * move. Nothing ever runs under the stale directory, and no manual reset is
 * needed. A session with no directory picks up the default silently.
 *
 * Publishes nothing: the turn being prepared marks the session running next,
 * and that update carries the change. An update of its own would show the
 * session idle — which reads as a settled turn, waking its queued backlog
 * into a turn that never hears the notice.
 */
export function prepareWorkingDirectory(
  db: KiriDb,
  snapshot: ConfigSnapshot,
  session: Session,
): { session: Session; notice?: string } {
  const stale = session.cwd === null ? null : staleCwdReason(session.cwd, sandboxOf(snapshot));
  const cleared = stale === null ? session : updateSessionCwd(db, session.id, null);
  const healed = healMissingCwd(db, snapshot, cleared);
  return stale === null
    ? { session: healed }
    : { session: healed, notice: cwdMoveNotice(stale, healed.cwd) };
}
