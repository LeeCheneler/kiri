import { describe, expect, it } from "bun:test";
import { inboxDelivery, queuedBy } from "./inbox-delivery.ts";

const QUEUED = ["user-queued", "session-queued"] as const;
const UNPROMPTED = ["settled", "startup"] as const;

describe("inboxDelivery", () => {
  it("leaves a running session's backlog to the turn in flight", () => {
    for (const trigger of [...QUEUED, ...UNPROMPTED]) {
      expect(inboxDelivery("running", trigger)).toBe("weave");
    }
  });

  it("wakes an idle session for a new message and for a backlog left behind", () => {
    for (const trigger of [...QUEUED, ...UNPROMPTED]) {
      expect(inboxDelivery("idle", trigger)).toBe("wake");
    }
  });

  it("wakes a failed session for a new message but never unprompted", () => {
    for (const trigger of QUEUED) expect(inboxDelivery("failed", trigger)).toBe("wake");
    for (const trigger of UNPROMPTED) expect(inboxDelivery("failed", trigger)).toBe("hold");
  });

  it("never starts a session paused on the user's approval", () => {
    for (const trigger of [...QUEUED, ...UNPROMPTED]) {
      expect(inboxDelivery("waiting", trigger)).toBe("hold");
    }
  });

  it("restarts a cancelled session only for the user's own new message", () => {
    expect(inboxDelivery("cancelled", "user-queued")).toBe("wake");
    expect(inboxDelivery("cancelled", "session-queued")).toBe("hold");
    for (const trigger of UNPROMPTED) expect(inboxDelivery("cancelled", trigger)).toBe("hold");
  });
});

describe("queuedBy", () => {
  it("separates the user's messages from another session's", () => {
    expect(queuedBy("user")).toBe("user-queued");
    expect(queuedBy("parent")).toBe("session-queued");
    expect(queuedBy("child")).toBe("session-queued");
  });
});
