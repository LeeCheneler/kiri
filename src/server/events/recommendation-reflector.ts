import { eq } from "drizzle-orm";
import type { KiriDb } from "../db/index.ts";
import { recommendations } from "../db/schema.ts";
import type { EventBus } from "./bus.ts";

/**
 * Reflect a spawned run's status onto the recommendation that actioned
 * it. The runner emits `run.updated` / `run.finished` for the spawned
 * run's own id; this looks up whether that run was actioned from a
 * recommendation (an indexed reverse lookup on `actionedRunId`) and, if
 * so, republishes a `recommendation.updated` event carrying the *parent*
 * run's id — so surfaces watching the parent refresh the recommendation's
 * status badge without tracking the cross-run link themselves.
 *
 * Subscribes to `bus`; returns the unsubscribe function.
 */
export function mountRecommendationReflector(db: KiriDb, bus: EventBus): () => void {
  return bus.subscribe((event) => {
    if (event.type !== "run.updated" && event.type !== "run.finished") return;
    const rec = db
      .select({ id: recommendations.id, runId: recommendations.runId })
      .from(recommendations)
      .where(eq(recommendations.actionedRunId, event.id))
      .get();
    if (!rec) return;
    bus.publish({
      type: "recommendation.updated",
      runId: rec.runId,
      recommendationId: rec.id,
      actionedRunId: event.id,
      status: event.status,
    });
  });
}
