import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";

// Unmount everything rendered by @testing-library/react after each test.
// Registered here (a preloaded module) so it applies to every test file —
// RTL's own auto-cleanup only attaches to the first file that imports it,
// which leaks the DOM across files in a multi-file `bun test` run.
afterEach(cleanup);
