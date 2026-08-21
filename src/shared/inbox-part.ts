/**
 * The transcript part a delivered inbox message becomes — a message that was
 * queued for the session and drained at a turn boundary. It lands where the
 * turn actually saw it: woven into the assistant message at the step boundary
 * it was injected at mid-turn, or as its own user-role message when it drained
 * ahead of a fresh turn. The part keeps the raw text; the server frames it for
 * the model at send time, and the client renders it as an interjection.
 *
 * Shared so the server's weave and the client's rendering agree on the shape.
 */
export interface InboxUIPart {
  type: "data-inbox";
  /** The inbox row's id, kept so a delivery is traceable and streamable under a stable id. */
  id: string;
  data: {
    /**
     * Who queued the message: the user, the session's parent (steering a
     * delegated worker), or one of the session's delegated children
     * (progress, questions, and results messaged back).
     */
    source: "user" | "parent" | "child";
    text: string;
    /**
     * A child sender's session id, so the delivery can name the worker by
     * its live title. Absent for the other sources — the receiving session
     * has exactly one user and one parent.
     */
    fromSessionId?: string;
    /** When the message was queued, epoch ms. */
    queuedAt: number;
  };
}

/** Whether `part` is a delivered inbox message. */
export const isInboxPart = (part: { type: string }): part is InboxUIPart =>
  part.type === "data-inbox";
