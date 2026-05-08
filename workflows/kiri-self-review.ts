import { z } from "zod";
import { defineWorkflow } from "../src/server/workflows/index.ts";

export const kiriSelfReview = defineWorkflow({
  name: "kiri-self-review",
  inputSchema: z.object({}),
  nodes: [{ kind: "script", path: "scripts/kiri-self-review/review.sh" }],
});
