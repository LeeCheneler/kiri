**Architecture and implementation improvements**

Work through these items in order, using small commits that each leave the project working. Split an item into several commits where needed. Add focused regression coverage with each behavior change, keep the existing quality gates, and update affected documentation alongside implementation.

- [x] **01 — Make attachment limits consistent end to end**

  **What:** Define shared per-file and total-message limits, including UTF-8, base64, and JSON overhead. Enforce them in the composer and message endpoint. Give the message route an appropriate body limit without widening unrelated endpoints. Verify representative files and mixed attachments through the complete application middleware.

  **Why:** The composer accepts files much larger than the server's 256 KiB request limit. A 200 KiB binary attachment already exceeds that limit once encoded. Accepted drafts should be sendable, and oversized drafts should fail clearly before submission.

- [x] **02 — Make session updates atomic**

  **What:** Validate every requested field before changing a session, commit the update as one operation, and publish changes after success. Cover a valid text-model change combined with an invalid image model.

  **Why:** The current PATCH handler can return 400 after changing the text model. Failed requests must leave state unchanged, and notifications must describe committed changes.

- [x] **03 — Complete project deletion and centralize owned-record cleanup**

  **What:** Include parent and worker inbox rows in project deletion. Consolidate session-owned cleanup into one operation, or use database cascades for unequivocal ownership. Preserve active-work restrictions and transactional rollback.

  **Why:** Project deletion duplicates part of session deletion and omits inbox records, causing foreign-key failures. Every new owned table should have one place where its deletion behavior is defined.

- [x] **04 — Make asynchronous configuration replacement deterministic**

  **What:** Serialize reloads or reject superseded generations, close displaced connection attempts, and prevent a reload from installing resources after shutdown. Preserve MCP connections leased by calls already running. Test reversed completion order using controlled promises.

  **Why:** An older reload can finish last and overwrite newer configuration. Overlapping replacements can also leave connections outside registry cleanup.

- [x] **05 — Invalidate model metadata when provider configuration changes**

  **What:** Key metadata caches by provider/configuration revision or invalidate them explicitly. Prevent results from an older in-flight lookup from populating the new revision's cache.

  **Why:** The picker refreshes its listing while execution can retain old context and reasoning metadata for five minutes. Both must describe the same configured endpoint.

- [x] **06 — Share public API and event contracts**

  **What:** Move browser-safe request/response types, statuses, errors, event payloads, and event names into feature-specific shared modules. Make server serializers satisfy those contracts. Keep dates explicitly serialized and private model facts separate from public descriptions. Split client API functions by feature as the contracts move.

  **Why:** Hand-mirrored types create repeated edits without proving that client and server agree. Sharing database row types or relying on assertions would preserve the underlying mismatch.

- [x] **07 — Reconcile transcripts using explicit revisions**

  **What:** Advance a monotonic transcript revision atomically with mutations and carry it through reads and relevant responses. Replace message/part-count freshness checks with revision-aware reconciliation. Protect local streaming work from late snapshots and cover same-size updates, deletions from another tab, and approval continuations.

  **Why:** A newer transcript can have the same number of parts or fewer messages. Size-based reconciliation leaves changed content stale and deleted messages visible.

- [x] **08 — Unify staged attachment state**

  **What:** Use one discriminated attachment list with shared identity, removal, ordering, size accounting, read status, and error aggregation. Preserve specialized readers and renderers. Handle pending reads, refused submissions, late reads after reset, and model changes after staging.

  **Why:** Parallel image/document/text-file pipelines repeat lifecycle logic and make each new kind expensive. Separate asynchronous paths can also overwrite errors or submit before reading finishes.

- [x] **09 — Introduce one effective configuration snapshot**

  **What:** Parse configuration through one service exposing an immutable revisioned snapshot and diagnostics. Replace independent per-section file reads and optional getters. Define which settings refresh per turn, step, or call. Preserve last-good connectivity and fail-closed filesystem behavior explicitly.

  **Why:** Related settings currently follow different timelines. A single owner makes valid edits, invalid edits, and runtime refresh behavior consistent without accidentally retaining filesystem access after a failed load.

- [x] **10 — Normalize model descriptions and isolate discovery**

  **What:** Replace per-fact lookups with provider-scoped cached model descriptions. Bound discovery requests, support cancellation, and retain useful unknown-capability fallbacks. Distinguish model, transport/adapter, and parser support. Attach provider middleware at resolution rather than threading unrelated callbacks through the generic builder. Make endpoint-specific behavior explicit where needed, preserving custom endpoints.

  **Why:** A turn currently waits for metadata discovery across unrelated providers. Capability facts also require repeated forwarding, and transport compatibility cannot be inferred from model identity alone.

- [x] **11 — Extract session preparation and tool assembly from HTTP**

  **What:** Move execution-context preparation and tool assembly into focused session modules shared by HTTP, worker spawning, wakes, and approval continuations. Centralize cwd healing and its explanation. Make session GET read-only. Preserve per-step instruction refresh and approval receipts. Use direct internal imports as code moves.

  **Why:** Session routes currently own runtime policy, and entry points apply different preparation. Common invariants should be reusable without invoking HTTP or remembering route-specific behavior.

- [x] **12 — Give each turn an explicit lifecycle owner and identity**

  **What:** Let the runtime acquire the session, identify the execution, register cancellation/stream resources, and settle/release them through one path. Handle startup failures before a stream exists. Reject stale completion and cleanup from an earlier turn. Make correctness-critical dependencies required and use small fakes in tests.

  **Why:** A session identifies a conversation; its active resources belong to a particular execution. Caller-dependent checks and cleanup make concurrent starts, preparation failures, and replacement turns difficult to reason about.

- [x] **13 — Put inbox scheduling and recovery entirely on the server**

  **What:** Remove browser withdrawal-and-resend promotion. Define delivery behavior for idle, running, waiting, failed, and cancelled sessions. Transfer inbox items into transcripts atomically or through explicit idempotent acknowledgement. Give submissions stable retry identities. Distinguish expected conflicts from uncertain transport failures, and preserve pending user work until its outcome is known.

  **Why:** DELETE followed by POST can lose a queued message between requests. Browser and server scheduling policies overlap, and treating every queue failure as permission to send again can obscure whether the first request succeeded. Cancellation must remain an explicit stop.

- [x] **14 — Consolidate built-in tool policy**

  **What:** Give each built-in a typed descriptor for its stable name, default permission, worker availability, management visibility, and output projection. Derive mechanical catalogue behavior from it. Keep executable factories, client rendering, and capability-grouped prompt prose in their appropriate layers.

  **Why:** Several independently maintained string lists describe the same tools. New tools should declare their mechanical policy once without introducing a universal plugin framework.

- [ ] **15 — Unify live and historical tool-output projection**

  **What:** Separate historical serialization from current execution availability. Use SDK conversion hooks with projections for known historical tools, including disabled tools. Apply generic compact encoding in a defined order while preserving text/JSON/error semantics. Remove duplicate strip transforms only after their behavior is covered.

  **Why:** Historical image and diff payloads still need removal after the originating tool is disabled. Passing only active tools into conversion loses that protection. Stored UI output must remain intact, and serialization must never enable execution.

- [ ] **16 — Extract the persistence barrier**

  **What:** Replace shared promise-resolver slots with an explicit barrier identified by turn and boundary. Cover work steps, approval results, summaries, and handoff notices. Release waits on cancellation/failure and preserve atomic transcript, inbox, checkpoint, and calibration writes.

  **Why:** Model execution and UI-stream persistence run on different timelines. Their coordination must prevent later actions from relying on unsaved results without resolving the wrong wait or hanging on failure.

- [ ] **17 — Extract pure context-management decisions**

  **What:** Express continue/compact/stop/handoff decisions as a pure function over explicit budgets, estimates, calibration, fixed context, approvals, incoming messages, and step state. Leave provider calls, persistence, and progress events in the execution layer. Preserve existing thresholds initially.

  **Why:** Context policy is buried inside stream callbacks and mutable flags. Explicit inputs make boundary cases testable and allow policy changes without modifying the execution protocol.

- [ ] **18 — Own application shutdown and disposal**

  **What:** Track active turns, workflow runs, background utility tasks, subscriptions, and pending reloads at application scope. Stop new scheduling, request cancellation, await settlement within a bound, then close MCP and SQLite. Make repeated shutdown signals safe and retain crash reconciliation.

  **Why:** Closing dependencies before their users settle permits incomplete cleanup and late writes. Workers should remain independent of their parent's turn while belonging to the application's lifetime.

- [ ] **19 — Version the persisted transcript boundary**

  **What:** Add a thin versioned read/validation/adaptation boundary around stored SDK message parts. Treat existing rows as an explicit legacy format. Preserve files, approvals, checkpoints, calibration, instruction receipts, and inbox parts. Keep format version distinct from transcript revision.

  **Why:** SDK formats are part of the durable storage contract. A compatibility boundary prevents future upgrades from spreading migration logic through storage, rendering, and execution. Continue using SDK messages internally.

- [ ] **20 — Validate incoming messages and use explicit approval commands**

  **What:** Validate the user message parts Kiri accepts and represent approval submission as a compact command against persisted pending calls. Derive trusted tool inputs and approval-learning records from server state. Preserve compact approval requests and attachment limits.

  **Why:** Arbitrary client-supplied assistant parts should not be the command protocol or a source of trusted tool inputs. Explicit commands make validation, retries, and error behavior easier to maintain.

- [ ] **21 — Consolidate shared domain operations and proven invariants**

  **What:** Move shared memory, article, project, and session operations out of tool/route adapters into their owning modules. Reuse validation, transactions, and post-commit publication where operations are genuinely shared. Evaluate database constraints for message ordering and parent/tool-call lineage against existing data before adding them.

  **Why:** The UI and model tools operate on the same records, but some business rules and queries live inside one adapter. Shared operations and appropriate constraints reduce drift without adding generic CRUD or repository abstractions.

- [ ] **22 — Make routine reads proportional to their output**

  **What:** Query session previews and latest activity directly instead of loading whole histories. Avoid repeatedly loading article bodies just to derive headings. Introduce maintained projections or indexes only where actual read patterns justify them, using representative fixtures and query plans.

  **Why:** Lists need small summaries, but their work can grow with full histories and attachment bytes. Keeping authoritative records complete does not require loading them for every summary view.

- [ ] **23 — Bound prompt indexes and use scoped retrieval**

  **What:** Give article and memory indexes explicit prompt budgets, indicate omitted entries, and use existing scoped knowledge retrieval for the rest. Keep mandatory standing instructions separate from optional discoverability indexes.

  **Why:** Indexes grow with retained work and consume fixed context that transcript compaction cannot remove. Saved knowledge should remain discoverable without occupying every request.

- [ ] **24 — Bound stream replay and transient progress retention**

  **What:** Measure retained replay state, keep only the necessary latest transient progress, and define replay byte limits with a valid snapshot/resume boundary using transcript revision and turn identity. Give slow readers an explicit recovery path. Verify reconnect during tools, approvals, checkpoints, and settlement.

  **Why:** Capping a console snapshot does not bound a buffer containing every snapshot. Full transcript clones, accumulated frames, and subscriber queues can grow for the lifetime of a long turn. Bounds must preserve durable content rather than discard arbitrary frames.

- [ ] **25 — Make event invalidation explicit and complete**

  **What:** Once scheduling belongs to the runtime, make UI events describe committed changes. Include parent/project identity where useful and maintain an auditable event-to-query-key mapping. Cover mutations from HTTP and tools, deletion/transfer of owners, and reconnect recovery.

  **Why:** Infinite query stale time makes invalidation part of correctness. Missing events leave views stale indefinitely, while synchronous execution triggered by notifications creates hidden ordering requirements.

- [ ] **26 — Measure whether binary assets need separate storage**

  **What:** After attachment and replay fixes, measure database size, response size, turn-start memory, and reconnect cost with representative binary histories. If justified, plan a workspace-local asset store with references, legacy data-URL reads, retention/deletion ownership, backup behavior, and missing-file recovery.

  **Why:** Inline bytes are simple but repeatedly stored, cloned, and transferred. Separate storage introduces its own lifecycle, so adopt it only when measurements justify that cost. Retaining inline storage is a valid outcome.

- [ ] **27 — Measure TOON's actual benefit**

  **What:** Compare representative projected tool outputs for token usage and reliable comprehension, covering live and replayed results. Label character-count proxies honestly. Record a keep, narrow, or remove decision using existing evaluation tooling where possible.

  **Why:** Fewer characters do not necessarily mean fewer provider tokens or better understanding. An extra transformation should earn its maintenance cost through useful workload evidence.

- [ ] **28 — Let an open view join a turn the server started**

  **What:** Expose the executing turn's identity to the browser: on the session detail while a turn is in flight, and on the message and stream responses a view attaches through. Have a view resume the live stream when the session's turn is not the one it is attached to, and only then. Cover a wake that follows straight after the view's own turn, a worker report waking an idle session, a second tab, and the window between a stream ending and its turn settling.

  **Why:** A view joins a live stream once, as it mounts. A turn the server starts afterwards — every inbox wake — shows only as busy, and its reply appears when the turn settles. Session status cannot fix this safely: the browser's stream can end before the server settles that same turn, and resuming then replays the turn into a duplicate, while a settle and the wake after it usually reach the browser as one change.

As behavior moves below HTTP, move its policy tests with it. Retain focused integration coverage for application limits, SDK conversion, persistence/approval ordering, and reconnect behavior. Mark an item complete when its behavior is verified and its obsolete paths are removed, rather than when files have merely been rearranged.
