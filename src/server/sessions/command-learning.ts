import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LlmClients } from "../llm/index.ts";
import { distillCommandGuidance, readCommandGuidance } from "./command-guidance.ts";
import {
  type CommandEvent,
  type CommandJudgementEvent,
  type CommandResolutionEvent,
  appendCommandEvent,
  readRecentCommandEvents,
  trimCommandLog,
} from "./command-judgement-log.ts";

// What one distillation reads, and what survives a successful one. The
// guidance file carries the durable state, so distilled events are free to
// fall off the log.
const RECENT_EVENTS_LIMIT = 100;
const LOG_KEEP = 200;

// Long enough to fold a turn's burst of decisions into one distillation,
// short enough that the next judgement usually reads fresh guidance.
const DEFAULT_DEBOUNCE_MS = 3000;

/**
 * The learning loop around the auto shell permission: every decision and user
 * verdict is appended to the judgement log, and each append schedules a
 * debounced, single-in-flight background distillation of the guidance file
 * the judge reads. Zero-config: with no utility model events still log, but
 * no distillation runs.
 */
export interface CommandLearning {
  recordJudgement(event: Omit<CommandJudgementEvent, "type" | "at">): void;
  recordResolution(event: Omit<CommandResolutionEvent, "type" | "at">): void;
  /** The current distilled guidance, read fresh from disk; empty when none. */
  guidance(): string;
  /** Run any pending distillation now and settle — for tests. */
  flush(): Promise<void>;
}

/**
 * Create a {@link CommandLearning} backed by the JSONL log and guidance file
 * under `.kiri`. Distillation failures keep the previous guidance; a server
 * stopped mid-distillation loses nothing — the guidance write is atomic and
 * the next recorded event schedules a fresh run.
 */
export function createCommandLearning(opts: {
  llmClients: Pick<LlmClients, "generateText">;
  /** Re-read per distillation, so a config edit applies to the next one. */
  getModel: () => string | undefined;
  logFile: string;
  guidanceFile: string;
  debounceMs?: number;
  distillTimeoutMs?: number;
}): CommandLearning {
  const {
    llmClients,
    getModel,
    logFile,
    guidanceFile,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    distillTimeoutMs,
  } = opts;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let rerun = false;

  const distillOnce = async (): Promise<void> => {
    const model = getModel();
    if (model === undefined) return;
    const events = readRecentCommandEvents(logFile, RECENT_EVENTS_LIMIT);
    if (events.length === 0) return;
    const next = await distillCommandGuidance({
      llmClients,
      model,
      previousGuidance: readCommandGuidance(guidanceFile),
      events,
      timeoutMs: distillTimeoutMs,
    });
    if (next === null) return;
    mkdirSync(dirname(guidanceFile), { recursive: true });
    // Write-then-rename: the judge reads this file synchronously between
    // events, so it must never observe a partial write.
    writeFileSync(`${guidanceFile}.tmp`, next);
    renameSync(`${guidanceFile}.tmp`, guidanceFile);
    // Only after success — a failed distillation keeps its full history.
    trimCommandLog(logFile, LOG_KEEP);
  };

  const start = (): Promise<void> => {
    if (running !== null) {
      // An event landed mid-distillation: latch a trailing rerun so it is
      // distilled too, rather than waiting for the event after it.
      rerun = true;
      return running;
    }
    running = distillOnce().finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        schedule();
      }
    });
    return running;
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void start();
    }, debounceMs);
    // A pending distillation must never hold the process open.
    timer.unref?.();
  };

  const record = (event: CommandEvent): void => {
    appendCommandEvent(logFile, event);
    schedule();
  };

  const at = () => new Date().toISOString();

  return {
    recordJudgement: (event) => record({ ...event, type: "judgement", at: at() }),
    recordResolution: (event) => record({ ...event, type: "resolution", at: at() }),
    guidance: () => readCommandGuidance(guidanceFile),
    flush: async () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await start();
      // A rerun latched during the awaited run re-schedules; drain that too.
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        await start();
      }
    },
  };
}
