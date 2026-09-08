/** A continuation summary saved at a boundary in an assistant message's transcript parts. */
export interface CheckpointUIPart {
  type: "data-checkpoint";
  id: string;
  data: { summary: string };
}

/** Whether a transcript part is a context checkpoint. */
export const isCheckpointPart = (part: { type: string }): part is CheckpointUIPart =>
  part.type === "data-checkpoint";
