/**
 * Marker carried as a cancelled tool call's `errorText`. Cancelling a turn stops
 * an in-flight call mid-flight, and the AI SDK has no terminal "cancelled" tool
 * state of its own, so the transcript records the call as an `output-error`
 * tagged with this text. The client renders it as cancelled rather than failed;
 * the model reads it as a tool result telling it the call never finished.
 *
 * Shared so the client's optimistic rewrite (on stop) and the server's persisted
 * one (on the turn settling) agree byte for byte.
 */
export const CANCELLED_ERROR_TEXT = "Cancelled by the user before it finished.";
