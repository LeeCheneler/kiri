import { configuredDelegateRoles } from "../config/schema.ts";
import type { ConfigService, ConfigSnapshot } from "../config/service.ts";
import type { ConfigStore } from "../config/store.ts";
import type { KiriDb } from "../db/index.ts";
import type { EventBus } from "../events/index.ts";
import type { LlmClients } from "../llm/index.ts";
import { getProject, listProjectArticles } from "../projects/store.ts";
import { createInstructionContext } from "./instruction-context.ts";
import { listMemories, listProjectMemories } from "./memory-tools.ts";
import { listSkills } from "./skills.ts";
import { type Session, getSession } from "./store.ts";
import { createSystemPromptBuilder } from "./system-prompt.ts";
import { summariseTaskList } from "./task-tools.ts";
import type { TurnTools } from "./turn-tools.ts";
import type { PreparedTurn, RunTurnDeps } from "./turn.ts";
import { prepareWorkingDirectory, sandboxOf } from "./working-directory.ts";

export interface TurnPreparationDeps {
  db: KiriDb;
  /** Workspace config; the system prompt and instruction files are read against it. */
  config: ConfigStore;
  /** The effective `kiri.yaml`; each prepared turn takes one snapshot of it. */
  configService: ConfigService;
  llmClients: LlmClients;
  bus: EventBus;
  turnTools: TurnTools;
}

/** Prepares turns the same way for every driver: a message, an approval continuation, a worker spawn, a wake. */
export interface TurnPreparation {
  /**
   * Make `session` ready to run a turn. Takes one config snapshot for the
   * whole turn — the tools offered, the sandbox the prompt enumerates, and
   * the delegate roles it names all describe the same config, whatever is
   * edited while the turn runs — and makes the working directory usable
   * against it (see `prepareWorkingDirectory`). When that moved the session,
   * this turn's prompt carries the notice explaining the move; from the next
   * turn the standard working-directory line is accurate on its own.
   */
  prepareTurn(session: Session): PreparedTurn;
}

/** Create the turn preparation a session surface shares between every driver of a turn. */
export function createTurnPreparation(deps: TurnPreparationDeps): TurnPreparation {
  const { db, config, configService, llmClients, bus, turnTools } = deps;

  // The prompt-layer context for a session's project: its name, the corpus
  // index the prompt map lists — each slug titled by its body's first heading,
  // falling back to the display name — the project's memory index, and its
  // standing instructions. Null for projectless sessions.
  const projectContextFor = (sessionId: string) => {
    const projectId = getSession(db, sessionId)?.projectId ?? null;
    const project = projectId !== null ? getProject(db, projectId) : undefined;
    if (!project) return null;
    return {
      name: project.name,
      articles: listProjectArticles(db, project.id).map((article) => ({
        slug: article.slug,
        heading: article.heading ?? article.name,
      })),
      memories: listProjectMemories(db, project.id),
      instructions: project.instructions,
      tasks: summariseTaskList(db, project.id),
    };
  };

  // The live, approval-gated catalogue over the per-lineage system prompt
  // (the builder picks the worker layer for a child), under one snapshot. A
  // child holds the same tools however its turn starts, and a pause on an ask
  // waits for the user identically from each driver.
  const turnDepsUnder = (sessionId: string, snapshot: ConfigSnapshot) => {
    // Resolve the tool names for the system prompt so the prompt's tool
    // guidance matches what the model is actually offered; the set the model
    // runs with is rebuilt against the turn's stream writer when the stream
    // starts. Both constructions gate identically, so the names always match.
    const toolNames = Object.keys(turnTools.activeTools(sessionId, snapshot));
    const sandbox = sandboxOf(snapshot);
    const instructionContext = createInstructionContext(() => ({
      config,
      project: projectContextFor(sessionId),
      workingDirectory: getSession(db, sessionId)?.cwd ?? null,
      allowedDirectories: sandbox,
    }));
    return {
      db,
      llmClients,
      bus,
      instructionContext,
      buildSystemPrompt: createSystemPromptBuilder(
        config,
        toolNames,
        sandbox,
        configuredDelegateRoles(snapshot.models.delegates),
        listSkills(config),
        listMemories(db),
        () => projectContextFor(sessionId),
        instructionContext,
      ),
      tools: ({ writer }) => turnTools.activeTools(sessionId, snapshot, writer, instructionContext),
    } satisfies RunTurnDeps;
  };

  return {
    prepareTurn(session) {
      const snapshot = configService.current();
      const prepared = prepareWorkingDirectory(db, snapshot, session);
      const base = turnDepsUnder(session.id, snapshot);
      const { notice } = prepared;
      if (notice === undefined) return { session: prepared.session, turnDeps: base };
      return {
        session: prepared.session,
        turnDeps: {
          ...base,
          buildSystemPrompt: (current: Session) => {
            const prompt = base.buildSystemPrompt(current);
            // A later move supersedes the directory named by the repair.
            return current.cwd === prepared.session.cwd ? `${prompt}\n\n${notice}` : prompt;
          },
        },
      };
    },
  };
}
