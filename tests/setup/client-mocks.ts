import { mock } from "bun:test";

// Children render their own coverage in their own tests; stub them at preload
// time so an `<App>` smoke test only pulls api.ts + app.tsx into coverage.
mock.module("../../src/client/components/workflow-list.tsx", () => ({
  WorkflowList: () => null,
}));
mock.module("../../src/client/components/run-feed.tsx", () => ({
  RunFeed: () => null,
}));
