import { z } from "zod";
import { defineWorkflow } from "../src/server/workflows/index.ts";

export const hello = defineWorkflow({
  name: "hello",
  inputSchema: z.object({}),
  nodes: [
    { kind: "script", path: "scripts/hello/pick-name.sh" },
    { kind: "script", path: "scripts/hello/greet.sh" },
  ],
});
