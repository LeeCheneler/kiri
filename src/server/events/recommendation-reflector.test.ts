import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { recommendations, runs } from "../db/schema.ts";
import { type KiriEvent, createEventBus } from "./bus.ts";
import { mountRecommendationReflector } from "./recommendation-reflector.ts";

describe("mountRecommendationReflector", () => {
  let dir: string;
  let db: KiriDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-reflector-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const insertRun = (id: string) =>
    db
      .insert(runs)
      .values({
        id,
        workflowName: "wf",
        status: "running",
        startedAt: new Date(),
        definitionSnapshot: {},
      })
      .run();

  const seedActioned = (parentId: string, recId: string, spawnedId: string) => {
    insertRun(parentId);
    insertRun(spawnedId);
    db.insert(recommendations)
      .values({
        id: recId,
        runId: parentId,
        index: 0,
        title: "t",
        workflow: "child-wf",
        actionedRunId: spawnedId,
        actionedAt: new Date(),
      })
      .run();
  };

  // Bus with a subscriber recording every event — the reflector is mounted
  // after, so a published run event and the reflected recommendation event
  // both land here.
  const collect = () => {
    const events: KiriEvent[] = [];
    const bus = createEventBus();
    bus.subscribe((e) => events.push(e));
    return { bus, events };
  };

  it("reflects a spawned run's terminal status onto its parent recommendation", () => {
    seedActioned("parent-1", "rec-1", "spawned-1");
    const { bus, events } = collect();
    mountRecommendationReflector(db, bus);

    bus.publish({ type: "run.finished", id: "spawned-1", status: "ok", workflowName: "child-wf" });

    expect(events).toContainEqual({
      type: "recommendation.updated",
      runId: "parent-1",
      recommendationId: "rec-1",
      actionedRunId: "spawned-1",
      status: "ok",
    });
  });

  it("reflects run.updated as well as run.finished", () => {
    seedActioned("parent-1", "rec-1", "spawned-1");
    const { bus, events } = collect();
    mountRecommendationReflector(db, bus);

    bus.publish({ type: "run.updated", id: "spawned-1", status: "failed" });

    expect(events.some((e) => e.type === "recommendation.updated" && e.status === "failed")).toBe(
      true,
    );
  });

  it("ignores run events for a run that wasn't actioned from a recommendation", () => {
    insertRun("orphan-1");
    const { bus, events } = collect();
    mountRecommendationReflector(db, bus);

    bus.publish({ type: "run.finished", id: "orphan-1", status: "ok", workflowName: "wf" });

    expect(events.some((e) => e.type === "recommendation.updated")).toBe(false);
  });

  it("ignores events other than run.updated / run.finished", () => {
    seedActioned("parent-1", "rec-1", "spawned-1");
    const { bus, events } = collect();
    mountRecommendationReflector(db, bus);

    bus.publish({ type: "run.step.updated", runId: "spawned-1", step: 0, status: "ok" });
    bus.publish({ type: "workflow.added", name: "wf" });

    expect(events.some((e) => e.type === "recommendation.updated")).toBe(false);
  });
});
