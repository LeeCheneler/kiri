import { zValidator } from "@hono/zod-validator";
import { type UIMessage, UI_MESSAGE_STREAM_HEADERS, isToolUIPart } from "ai";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type * as articlesApi from "../../shared/api/articles.ts";
import type * as errorsApi from "../../shared/api/errors.ts";
import type * as modelsApi from "../../shared/api/models.ts";
import type { PageQuery } from "../../shared/api/pagination.ts";
import type * as sessionsApi from "../../shared/api/sessions.ts";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";
import {
  MESSAGE_BODY_LIMIT_BYTES,
  MESSAGE_SIZE_ERROR,
  messagePartsError,
} from "../../shared/message-limits.ts";
import type { ModelsConfig } from "../config/schema.ts";
import type { ConfigService } from "../config/service.ts";
import type { KiriDb } from "../db/index.ts";
import { articles, sessions as sessionsTable } from "../db/schema.ts";
import type { EventBus } from "../events/index.ts";
import { EFFORT_LEVELS, type LlmClients, toModelInfo } from "../llm/index.ts";
import { createLogger } from "../log.ts";
import { getProject, listProjectArticles } from "../projects/store.ts";
import { withoutContextCalibration } from "../sessions/context-calibration.ts";
import {
  SESSION_TITLE_MAX_LENGTH,
  type ToolApprovalDecision,
  buildSessionListEntries,
  createSession,
  deleteMessagesFrom,
  deleteSession,
  enqueueInboxItem,
  generateSessionTitle,
  generateSuggestedReplies,
  getInboxItem,
  getSession,
  getSessionChildren,
  getSessionLabels,
  getSessionLastActivity,
  getSessionMessages,
  pendingInboxItems,
  transcribeDraft,
  updateSessionSettings,
  withdrawInboxItem,
} from "../sessions/index.ts";
import type { SessionRuntime } from "../sessions/runtime.ts";
import { ShuttingDownError, TurnInFlightError } from "../sessions/turn-lifecycle.ts";
import type { TurnStart } from "../sessions/turn-start.ts";
import { defaultWorkingDirectory } from "../sessions/working-directory.ts";
import {
  serializeInboxItem,
  serializeMessage,
  serializeSession,
  serializeSessionListEntry,
} from "./serializers/sessions.ts";
import { articleParamSchema, onZodFail } from "./shared.ts";

const sessionsLog = createLogger("sessions");

export interface SessionsRoutesDeps {
  db: KiriDb;
  /**
   * Required: every session resolves and streams turns against a model, and
   * the picker lists models off this same client — a session surface without
   * it is inert, so `createApp` leaves these routes unmounted when it's absent.
   */
  llmClients: LlmClients;
  bus?: EventBus;
  /**
   * The workspace's effective `kiri.yaml`, read at the point of use: the
   * models config rides the model listing so the pickers can pin shortcuts,
   * and a new session starts in the default working directory.
   */
  configService: ConfigService;
  /** What prepares and runs this surface's turns, shared with the worker spawns and wakes that start turns without HTTP. */
  runtime: SessionRuntime;
}

const DEFAULT_SESSION_LIMIT = 25;
const MAX_SESSION_LIMIT = 100;

const sessionIdParamSchema = z.object({ id: z.string().min(1) });

const messageParamSchema = z.object({ id: z.string().min(1), messageId: z.string().min(1) });

// `imageModel` starts the session with image generation on — the
// first-shortcut default when image shortcuts are configured; otherwise it's
// simply not sent. `projectId` creates the session within a project; later
// assignment uses the move endpoint so its articles transfer with it.
const createSessionBodySchema = z
  .object({
    model: z.string().min(1),
    imageModel: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<sessionsApi.CreateSessionRequest>;

// A push-to-talk recording needs a larger request limit, so the
// app-wide body limit exempts this path and the route carries its own cap:
// the ceiling OpenAI (and OpenRouter after it) puts on an audio upload.
export const TRANSCRIBE_PATH = "/api/transcribe";
const TRANSCRIBE_BODY_LIMIT_BYTES = 25 * 1024 * 1024;

// A message queued for a running turn. Text only: images can't ride the inbox,
// and the client blocks queueing them rather than dropping parts. The sender
// names the submission so it can repeat one whose outcome it never learned.
const inboxBodySchema = z
  .object({ id: z.string().uuid(), text: z.string().trim().min(1) })
  .strict() satisfies z.ZodType<sessionsApi.QueueSessionMessageRequest>;

const inboxItemParamSchema = z.object({ id: z.string().min(1), itemId: z.string().min(1) });

// Any field may be set independently: the aside swaps the models and the
// rename control sets `title` (`null` clears it), both through this one
// endpoint. Omitting a field leaves it unchanged.
// The working directory is deliberately absent: the assistant moves it
// through its own sandbox-validated tool, and a missing or cleared value
// heals from the configured default when the session is next loaded — there
// is nothing for the app to write.
const patchSessionBodySchema = z
  .object({
    model: z.string().min(1).optional(),
    imageModel: z.string().min(1).nullable().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    title: z.string().trim().min(1).max(SESSION_TITLE_MAX_LENGTH).nullable().optional(),
  })
  .strict() satisfies z.ZodType<sessionsApi.PatchSessionRequest>;

const sessionListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SESSION_LIMIT).default(DEFAULT_SESSION_LIMIT),
}) satisfies z.ZodType<PageQuery>;

// A user message is what the composer builds and nothing else: a tool, data,
// or reasoning part is the server's to write, and one arriving here would be
// stored as though it were. Fields the schema doesn't name are dropped, so
// what is stored is exactly what was checked.
const userPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("file"),
    mediaType: z.string().min(1),
    url: z.string().min(1),
    filename: z.string().optional(),
  }),
]);

// Only the trailing message rides the request; the server loads the prior turns
// from the DB. Usually a new `user` message; on an approval resume the client
// re-sends the paused `assistant` message carrying the user's verdicts, whose
// parts are read for those verdicts alone.
const turnBodySchema = z.object({
  message: z.union([
    z.object({
      id: z.string().min(1).optional(),
      role: z.literal("user").optional(),
      parts: z.array(userPartSchema).min(1),
    }),
    z.object({
      id: z.string().min(1).optional(),
      role: z.literal("assistant"),
      parts: z.array(z.unknown()).min(1),
    }),
  ]),
}) satisfies z.ZodType<sessionsApi.SessionTurnRequest>;

// Whether a message awaits the user's verdict — its last assistant turn called a
// tool that hasn't been allowed or denied yet.
const hasPendingApproval = (parts: UIMessage["parts"]): boolean =>
  parts.some((part) => isToolUIPart(part) && part.state === "approval-requested");

// Pull the user's tool-approval verdicts out of a resumed assistant message.
const extractApprovals = (parts: UIMessage["parts"]): ToolApprovalDecision[] => {
  const decisions: ToolApprovalDecision[] = [];
  for (const part of parts) {
    if (isToolUIPart(part) && part.state === "approval-responded") {
      decisions.push({
        toolCallId: part.toolCallId,
        approved: part.approval.approved,
        reason: part.approval.reason,
      });
    }
  }
  return decisions;
};

/**
 * Build the Hono sub-app for the agentic session surface: model listing,
 * session create/list/get, the streaming turn endpoint, the session article
 * reads, and turn cancellation. Mounted under `/api` by `createApp`,
 * alongside the system routes.
 */
export function sessionsRoutes(deps: SessionsRoutesDeps): Hono {
  const { db, configService, llmClients, bus, runtime } = deps;
  const { streamRegistry, commandLearning } = runtime;
  const app = new Hono();

  const modelsConfig = (): ModelsConfig => configService.current().models;

  // The listing carries the configured model shortcuts alongside the models,
  // so the pickers can pin them and new sessions can start on the first one,
  // and the utility model, so the client knows which utility-driven actions
  // to offer. Read live, so a kiri.yaml edit is reflected on the next fetch. Only
  // each description's public view is sent: the reasoning, native-document
  // and transport facts drive what a turn sends the provider, and nothing
  // client-side consumes them.
  app.get("/models", async (c) => {
    const { models, failures } = await llmClients.listModels();
    return c.json({
      models: models.map(toModelInfo),
      failures,
      shortcuts: modelsConfig().shortcuts,
      utility: modelsConfig().utility,
      transcription: modelsConfig().transcription,
    } satisfies modelsApi.ModelsResult);
  });

  // Turn a push-to-talk recording into trimmed draft text. Nothing is
  // persisted. No transcription model configured is the feature's off switch —
  // the client hides the mic — so a request without one is a plain 400.
  app.post(
    "/transcribe",
    bodyLimit({
      maxSize: TRANSCRIBE_BODY_LIMIT_BYTES,
      onError: (c) =>
        c.json({ error: "request body too large" } satisfies errorsApi.ApiErrorBody, 413),
    }),
    async (c) => {
      const transcriptionModel = modelsConfig().transcription;
      if (transcriptionModel === undefined) {
        return c.json(
          { error: "no transcription model configured" } satisfies errorsApi.ApiErrorBody,
          400,
        );
      }
      const { audio } = await c.req.parseBody();
      if (!(audio instanceof File) || audio.size === 0) {
        return c.json({ error: "invalid audio" } satisfies errorsApi.ApiErrorBody, 400);
      }
      const text = await transcribeDraft({
        llmClients,
        transcriptionModel,
        audio: new Uint8Array(await audio.arrayBuffer()),
      });
      // A capture that comes back empty is the thing to see when push-to-talk
      // seems to do nothing: the bytes reached the model, and it heard silence.
      sessionsLog.info(
        `transcribed ${audio.size} bytes of ${audio.type || "audio"} with ${transcriptionModel}: ${text.length} chars`,
      );
      return c.json({ text } satisfies sessionsApi.TranscriptionResult);
    },
  );

  app.post(
    "/sessions",
    zValidator("json", createSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { model, imageModel, projectId } = c.req.valid("json");
      // Validate the models resolve now, at create time, so a bad id fails the
      // create with the resolver's own message rather than a later turn.
      try {
        llmClients.resolveModel(model);
        if (imageModel !== undefined) llmClients.resolveModel(imageModel);
      } catch (cause) {
        return c.json(
          {
            error: cause instanceof Error ? cause.message : "invalid model",
          } satisfies errorsApi.ApiErrorBody,
          400,
        );
      }
      // The project must exist at create — membership is set once here, so a
      // stale id fails the create rather than minting an orphaned session.
      if (projectId !== undefined && !getProject(db, projectId)) {
        return c.json(
          { error: `project "${projectId}" not found` } satisfies errorsApi.ApiErrorBody,
          400,
        );
      }
      const cwd = defaultWorkingDirectory(configService.current());
      const session = createSession(db, model, {
        ...(imageModel !== undefined ? { imageModel } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
      });
      bus?.publish({ type: "session.started", id: session.id });
      return c.json(
        { session: serializeSession(session) } satisfies sessionsApi.SessionResult,
        201,
      );
    },
  );

  app.get(
    "/sessions",
    zValidator("query", sessionListQuerySchema, onZodFail("invalid query")),
    (c) => {
      const { cursor, limit } = c.req.valid("query");

      // Keyset pagination on (started_at DESC, id DESC), mirroring runs: the
      // cursor is the last seen session's id; resolve its started_at and page
      // strictly after that point. Designed as a compound key from the outset
      // so a later runs+sessions feed union stays a query change, not a rewrite.
      let anchor: { startedAt: Date; id: string } | undefined;
      if (cursor !== undefined) {
        const found = db
          .select({ startedAt: sessionsTable.startedAt, id: sessionsTable.id })
          .from(sessionsTable)
          .where(eq(sessionsTable.id, cursor))
          .get();
        if (!found)
          return c.json(
            { error: `cursor "${cursor}" not found` } satisfies errorsApi.ApiErrorBody,
            400,
          );
        anchor = found;
      }

      const rows = db
        .select()
        .from(sessionsTable)
        .where(
          and(
            // Child sessions are part of their parent's transcript, not
            // standalone activity — the list shows only top-level sessions.
            isNull(sessionsTable.parentSessionId),
            anchor
              ? or(
                  lt(sessionsTable.startedAt, anchor.startedAt),
                  and(
                    eq(sessionsTable.startedAt, anchor.startedAt),
                    lt(sessionsTable.id, anchor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(sessionsTable.startedAt), desc(sessionsTable.id))
        .limit(limit)
        .all();

      const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
      return c.json({
        sessions: buildSessionListEntries(db, rows).map(serializeSessionListEntry),
        nextCursor,
      } satisfies sessionsApi.SessionsPage);
    },
  );

  app.get(
    "/sessions/:id/articles",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getSession(db, id))
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // The same projection as a run's article list: the body is fetched only
      // to derive the heading, never echoed — the detail route serves it.
      const rows = db
        .select()
        .from(articles)
        .where(eq(articles.sessionId, id))
        .orderBy(asc(articles.createdAt))
        .all();
      return c.json({
        articles: rows.map((article) => ({
          slug: article.slug,
          name: article.name,
          heading: extractFirstHeading(article.contentMd),
          createdAt: article.createdAt.toISOString(),
        })),
      } satisfies articlesApi.ArticlesResult);
    },
  );

  app.delete(
    "/sessions/:id/articles/:slug",
    zValidator("param", articleParamSchema, onZodFail("invalid article slug")),
    (c) => {
      const { id, slug } = c.req.valid("param");
      if (!getSession(db, id))
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const article = db
        .select()
        .from(articles)
        .where(and(eq(articles.sessionId, id), eq(articles.slug, slug)))
        .get();
      if (!article) {
        return c.json(
          {
            error: `article "${slug}" not found on session "${id}"`,
          } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      db.delete(articles).where(eq(articles.id, article.id)).run();
      bus?.publish({ type: "article.deleted", sessionId: id, slug });
      return c.body(null, 204);
    },
  );

  app.get(
    "/sessions/:id/articles/:slug",
    zValidator("param", articleParamSchema, onZodFail("invalid article slug")),
    (c) => {
      const { id, slug } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const article = db
        .select()
        .from(articles)
        .where(
          and(
            session.projectId === null
              ? eq(articles.sessionId, id)
              : eq(articles.projectId, session.projectId),
            eq(articles.slug, slug),
          ),
        )
        .get();
      if (!article) {
        return c.json(
          {
            error: `article "${slug}" not found on session "${id}"`,
          } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      return c.json({
        id: article.id,
        sessionId: id,
        // Old transcript links follow the article into the project's corpus.
        projectId: article.projectId,
        // The reading view situates the article under its session by name, so
        // the label rides along rather than costing a second round-trip.
        sessionLabel: getSessionLabels(db, [id]).get(id) ?? id.slice(0, 8),
        slug: article.slug,
        name: article.name,
        contentMd: article.contentMd,
        createdAt: article.createdAt.toISOString(),
        heading: extractFirstHeading(article.contentMd),
      } satisfies articlesApi.SessionArticleDetail);
    },
  );

  app.get(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const parentId = session.parentSessionId;
      const snapshot = streamRegistry.snapshotBeforeTurn(id) ?? {
        messages: getSessionMessages(db, id),
        transcriptRevision: session.transcriptRevision,
      };
      return c.json({
        session: serializeSession(session),
        transcriptRevision: snapshot.transcriptRevision,
        // Replaying a live stream starts from its original transcript. Durable
        // checkpoints already contain some of those frames and would duplicate
        // text/steps if used as the client's starting point.
        messages: withoutContextCalibration(snapshot.messages.map(serializeMessage)),
        // The undelivered backlog rides the detail so queued messages stay
        // visible across reloads and other views — the inbox table, not any
        // client's local state, is the queue's source of truth.
        inbox: pendingInboxItems(db, id).map(serializeInboxItem),
        // A delegated child names the session that spawned it so its page can
        // link back up; a top-level session carries null.
        parent:
          parentId !== null
            ? { id: parentId, label: getSessionLabels(db, [parentId]).get(parentId) ?? parentId }
            : null,
      } satisfies sessionsApi.SessionDetail);
    },
  );

  // The sessions a session's delegate calls have spawned. Children are hidden
  // from the list and feed, so this is how the transcript finds the child
  // behind a delegate tool call — matched client-side on parentToolCallId —
  // including one still mid-run after a reload. Each child carries when it
  // last moved — its newest message, else its start — so the aside can read
  // recency at a glance without loading any child's transcript.
  app.get(
    "/sessions/:id/children",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      if (!getSession(db, id))
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const children = getSessionChildren(db, id);
      const lastActivity = getSessionLastActivity(
        db,
        children.map((child) => child.id),
      );
      return c.json({
        children: children.map((child) => ({
          ...serializeSession(child),
          lastActivityAt: (lastActivity.get(child.id) ?? child.startedAt).toISOString(),
        })),
      } satisfies sessionsApi.SessionChildrenResult);
    },
  );

  app.get(
    "/sessions/:id/stream",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      // Resume an in-flight turn: replay what's buffered, then stream live. With
      // no turn in flight there's nothing to rejoin — a 204 tells the client's
      // resume to stand down and read the settled turn from storage instead.
      const body = streamRegistry.subscribe(c.req.valid("param").id);
      if (!body) return c.body(null, 204);
      return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
    },
  );

  // Tap-to-send replies to the session's settled last turn, generated on
  // demand against the utility model. Nothing is persisted or pushed — the
  // chips are the requesting client's affair, so a moment nobody is looking
  // at costs nothing. Every "not now" case is a plain empty list rather than
  // an error: no utility model configured (the feature's off switch), a
  // delegated child, a turn in flight or awaiting approval (the approval
  // prompt is the reply surface), or a last message a chip can't answer —
  // absence of chips is the common, first-class outcome.
  app.get(
    "/sessions/:id/suggested-replies",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    async (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      const none = { replies: [] as string[] };
      const model = modelsConfig().utility;
      if (model === undefined) return c.json(none satisfies sessionsApi.SuggestedRepliesResult);
      if (session.parentSessionId !== null || session.status !== "idle")
        return c.json(none satisfies sessionsApi.SuggestedRepliesResult);
      const last = getSessionMessages(db, id).at(-1);
      if (!last || last.role !== "assistant")
        return c.json(none satisfies sessionsApi.SuggestedRepliesResult);
      if (hasPendingApproval(last.parts))
        return c.json(none satisfies sessionsApi.SuggestedRepliesResult);
      const assistantText = last.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (assistantText === "") return c.json(none satisfies sessionsApi.SuggestedRepliesResult);
      const replies = await generateSuggestedReplies({ llmClients, model, assistantText });
      return c.json({ replies } satisfies sessionsApi.SuggestedRepliesResult);
    },
  );

  app.patch(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", patchSessionBodySchema, onZodFail("invalid session")),
    (c) => {
      const { id } = c.req.valid("param");
      const settings = c.req.valid("json");
      const { model, imageModel } = settings;
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // Resolve both models before writing any setting. The schema has already
      // validated effort and title; null disables image generation.
      try {
        if (model !== undefined) llmClients.resolveModel(model);
        if (imageModel !== undefined && imageModel !== null) llmClients.resolveModel(imageModel);
      } catch (cause) {
        return c.json(
          {
            error: cause instanceof Error ? cause.message : "invalid model",
          } satisfies errorsApi.ApiErrorBody,
          400,
        );
      }
      const updated = updateSessionSettings(db, id, settings);
      // The turn endpoint resolves the model per turn, so a change applies
      // from the next turn. Announce it like any other session change so the
      // feed and the open chat refresh; status is unchanged.
      bus?.publish({ type: "session.updated", id, status: updated.status });
      return c.json({ session: serializeSession(updated) } satisfies sessionsApi.SessionResult);
    },
  );

  app.post(
    "/sessions/:id/move",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator(
      "json",
      z
        .object({ projectId: z.string().min(1) })
        .strict() satisfies z.ZodType<sessionsApi.MoveSessionRequest>,
      onZodFail("invalid project"),
    ),
    (c) => {
      const { id } = c.req.valid("param");
      const { projectId } = c.req.valid("json");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      if (!getProject(db, projectId)) {
        return c.json(
          { error: `project "${projectId}" not found` } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      if (session.parentSessionId !== null) {
        return c.json(
          {
            error: "Move the parent session to move its delegated sessions.",
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      if (session.projectId !== null) {
        return c.json(
          { error: "This session already belongs to a project." } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      const family = [session, ...getSessionChildren(db, id)];
      if (family.some((row) => row.status === "running" || row.status === "waiting")) {
        return c.json(
          {
            error: "Finish or cancel all turns and resolve pending approvals before moving.",
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      const ids = family.map((row) => row.id);
      const movingArticles = db
        .select()
        .from(articles)
        .where(inArray(articles.sessionId, ids))
        .all();
      const slugs = new Set(listProjectArticles(db, projectId).map((article) => article.slug));
      for (const article of movingArticles) {
        if (slugs.has(article.slug)) {
          return c.json(
            {
              error: `Article slug "${article.slug}" conflicts. Choose another project or resolve the duplicate before moving.`,
            } satisfies errorsApi.ApiErrorBody,
            409,
          );
        }
        slugs.add(article.slug);
      }
      // No async work between validation and transfer: a turn cannot start
      // with the old scope while this transaction changes its article owner.
      db.transaction((tx) => {
        tx.update(articles)
          .set({ sessionId: null, projectId })
          .where(inArray(articles.sessionId, ids))
          .run();
        tx.update(sessionsTable).set({ projectId }).where(inArray(sessionsTable.id, ids)).run();
      });
      for (const row of family) {
        bus?.publish({ type: "session.updated", id: row.id, status: row.status });
      }
      for (const article of movingArticles) {
        bus?.publish({
          type: "article.written",
          sessionId: article.sessionId as string,
          projectId,
          slug: article.slug,
        });
      }
      return c.json({
        session: serializeSession({ ...session, projectId }),
      } satisfies sessionsApi.SessionResult);
    },
  );

  app.post(
    "/sessions/:id/messages",
    bodyLimit({
      maxSize: MESSAGE_BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: MESSAGE_SIZE_ERROR } satisfies errorsApi.ApiErrorBody, 413),
    }),
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", turnBodySchema, onZodFail("invalid message")),
    async (c) => {
      const { id } = c.req.valid("param");
      const { message } = c.req.valid("json");
      if (message.role !== "assistant") {
        const error = messagePartsError(message.parts);
        if (error) return c.json({ error } satisfies errorsApi.ApiErrorBody, 400);
      }
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // A session is long-lived and resumable: after an idle, failed, or
      // cancelled turn it accepts the next message, picking the conversation
      // back up. Only a concurrent turn is refused, by the start itself.
      const start = async (turn: Exclude<TurnStart, { kind: "wake" }>) => {
        try {
          return (await runtime.startTurn(session, turn)).response;
        } catch (cause) {
          if (cause instanceof TurnInFlightError)
            return c.json({ error: cause.message } satisfies errorsApi.ApiErrorBody, 409);
          if (cause instanceof ShuttingDownError)
            return c.json({ error: cause.message } satisfies errorsApi.ApiErrorBody, 503);
          throw cause;
        }
      };
      const priorMessages = getSessionMessages(db, id);
      const last = priorMessages.at(-1);
      const pending = last?.role === "assistant" && hasPendingApproval(last.parts);

      // The turn checkpoints and finalises its own persistence, so the route
      // just hands back the streamed response. The turn is drained
      // server-side, so a client that disconnects doesn't cancel it; only an
      // explicit cancel through `POST /api/sessions/:id/cancel` does.

      // An assistant message carries the user's verdicts on a paused turn's tool
      // calls: resume it rather than starting a new turn.
      if (message.role === "assistant") {
        if (!pending) {
          return c.json(
            {
              error: `session "${id}" has no pending tool approval to resolve`,
            } satisfies errorsApi.ApiErrorBody,
            409,
          );
        }
        const parts = message.parts as UIMessage["parts"];
        // Every answered run_command feeds the learning loop — under "ask" as
        // much as "auto", since an approval is precedent either way.
        for (const part of parts) {
          if (
            isToolUIPart(part) &&
            part.state === "approval-responded" &&
            part.type === "tool-run_command"
          ) {
            commandLearning.recordResolution({
              toolCallId: part.toolCallId,
              command: (part.input as { command?: string })?.command ?? "",
              approved: part.approval.approved,
            });
          }
        }
        return start({ kind: "approvals", approvals: extractApprovals(parts) });
      }

      // A new user message can't start while a tool approval is still pending —
      // the model can't continue past an unanswered tool call.
      if (pending) {
        return c.json(
          {
            error: `session "${id}" has a pending tool approval; respond to it first`,
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }

      // A session names itself off its opening message: a one-off generation
      // against the utility model (the session's own model when none is
      // configured), fired alongside the turn rather than awaited by it, so
      // the title lands in the list and feed while the reply is still
      // streaming. First message only — a session left untitled by a failed
      // call stays untitled rather than fighting a user who cleared the title.
      const userText = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      if (session.title === null && priorMessages.length === 0 && userText !== "") {
        runtime.background("session title", () =>
          generateSessionTitle({
            db,
            llmClients,
            sessionId: id,
            userText,
            model: modelsConfig().utility ?? session.model,
            publish: (event) => bus?.publish(event),
          }),
        );
      }

      const userMessage: UIMessage = {
        id: message.id ?? crypto.randomUUID(),
        role: "user",
        parts: message.parts,
      };
      return start({ kind: "message", userMessage });
    },
  );

  app.delete(
    "/sessions/:id",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // A running session has a turn streaming and persisting server-side;
      // deleting mid-turn would orphan that write, so require a cancel first.
      // A delegated worker runs detached from its parent's turns, so its
      // in-flight turn blocks the parent's delete the same way.
      if (session.status === "running") {
        return c.json(
          {
            error: `session "${id}" has a turn in flight; cancel it first`,
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      if (getSessionChildren(db, id).some((child) => child.status === "running")) {
        return c.json(
          {
            error: `session "${id}" has a delegated worker running; cancel it first`,
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      deleteSession(db, id);
      bus?.publish({ type: "session.deleted", id });
      return c.body(null, 204);
    },
  );

  app.delete(
    "/sessions/:id/messages/:messageId",
    zValidator("param", messageParamSchema, onZodFail("invalid session or message id")),
    (c) => {
      const { id, messageId } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // A running session has a turn streaming and persisting server-side;
      // truncating mid-turn would race that write, so require a cancel first —
      // matching the delete/cancel guards.
      if (session.status === "running") {
        return c.json(
          {
            error: `session "${id}" has a turn in flight; cancel it first`,
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      const transcriptRevision = deleteMessagesFrom(db, id, messageId);
      if (transcriptRevision === undefined) {
        return c.json(
          {
            error: `message "${messageId}" not found in session "${id}"`,
          } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      // Other views only learn of transcript changes from the bus, and a plain
      // delete — unlike an edit-and-resend — has no follow-up turn to announce
      // one, so publish the change here.
      bus?.publish({ type: "session.updated", id, status: session.status });
      return c.json({ transcriptRevision } satisfies sessionsApi.TranscriptMutationResult);
    },
  );

  app.post(
    "/sessions/:id/inbox",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    zValidator("json", inboxBodySchema, onZodFail("invalid message")),
    (c) => {
      const { id } = c.req.valid("param");
      const { id: itemId, text } = c.req.valid("json");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // A repeated submission answers with the message it already queued,
      // whatever has happened to the session since — the sender is asking
      // what became of it, not queueing another.
      const accepted = getInboxItem(db, itemId);
      if (accepted && accepted.sessionId !== id) {
        return c.json(
          {
            error: `message "${itemId}" was queued for another session`,
          } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      if (accepted) {
        return c.json({
          item: serializeInboxItem(accepted),
          delivered: accepted.deliveredAt !== null,
        } satisfies sessionsApi.SessionInboxResult);
      }
      // Accepted whatever the session is doing: the delivery policy weaves
      // the message into a running turn, holds it for a paused one, or starts
      // a turn for it. The sender never has to pick another endpoint because
      // the turn it was queueing for settled first.
      const item = enqueueInboxItem(db, id, { id: itemId, source: "user", text });
      bus?.publish({ type: "session.inbox.queued", sessionId: id, source: "user" });
      return c.json(
        {
          item: serializeInboxItem(item),
          delivered: false,
        } satisfies sessionsApi.SessionInboxResult,
        201,
      );
    },
  );

  app.delete(
    "/sessions/:id/inbox/:itemId",
    zValidator("param", inboxItemParamSchema, onZodFail("invalid session or item id")),
    (c) => {
      const { id, itemId } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // Withdrawing races delivery, and delivery wins: once the turn has
      // acknowledged the item it is no longer pending, so the 404 doubles as
      // the "already delivered" signal.
      if (!withdrawInboxItem(db, id, itemId)) {
        return c.json(
          {
            error: `message "${itemId}" is not queued for session "${id}"`,
          } satisfies errorsApi.ApiErrorBody,
          404,
        );
      }
      return c.body(null, 204);
    },
  );

  app.post(
    "/sessions/:id/cancel",
    zValidator("param", sessionIdParamSchema, onZodFail("invalid session id")),
    (c) => {
      const { id } = c.req.valid("param");
      const session = getSession(db, id);
      if (!session)
        return c.json({ error: `session "${id}" not found` } satisfies errorsApi.ApiErrorBody, 404);
      // False when no turn holds the session: it was never running, or it
      // settled between the client's read and this call.
      if (!runtime.cancelTurn(id)) {
        return c.json(
          { error: `session "${id}" is not in flight` } satisfies errorsApi.ApiErrorBody,
          409,
        );
      }
      return c.json({ sessionId: id } satisfies sessionsApi.SessionCancelResult, 202);
    },
  );

  return app;
}
