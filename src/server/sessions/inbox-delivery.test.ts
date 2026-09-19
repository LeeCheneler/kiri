import { describe, expect, it } from "bun:test";
import { inboxDelivery } from "./inbox-delivery.ts";

describe("inboxDelivery", () => {
  it("leaves a running session's backlog to the turn in flight", () => {
    expect(inboxDelivery("running", "queued")).toBe("weave");
    expect(inboxDelivery("running", "settled")).toBe("weave");
  });

  it("wakes an idle session for a new message and for a backlog its turn left behind", () => {
    expect(inboxDelivery("idle", "queued")).toBe("wake");
    expect(inboxDelivery("idle", "settled")).toBe("wake");
  });

  it("wakes a failed session for a new message but not on its own settle", () => {
    expect(inboxDelivery("failed", "queued")).toBe("wake");
    expect(inboxDelivery("failed", "settled")).toBe("hold");
  });

  it("never starts a session the user must act on first", () => {
    for (const status of ["waiting", "cancelled"] as const) {
      expect(inboxDelivery(status, "queued")).toBe("hold");
      expect(inboxDelivery(status, "settled")).toBe("hold");
    }
  });
});
