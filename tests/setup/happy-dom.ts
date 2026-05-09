import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom registers DOM globals (window, document, navigator, …) but also
// replaces fetch primitives with browser-spec implementations. Two of those
// implementations break us: its Request strips the Origin header (Hono CORS
// tests), and its AbortSignal/EventTarget aren't recognised by MSW's
// interceptor. Stash the natives, register happy-dom, then put the natives
// back so server tests and MSW continue to work.
const nativeKeys = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "AbortController",
  "AbortSignal",
  "EventTarget",
  "Event",
  "MessageEvent",
] as const;

const native: Record<string, unknown> = {};
for (const key of nativeKeys) native[key] = (globalThis as Record<string, unknown>)[key];

GlobalRegistrator.register({ url: "http://localhost:5173/" });

for (const [key, value] of Object.entries(native)) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}
