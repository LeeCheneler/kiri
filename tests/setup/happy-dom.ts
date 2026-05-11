import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { FakeIntersectionObserver } from "./fake-intersection-observer.ts";

// happy-dom registers DOM globals (window, document, navigator, …) but also
// replaces fetch primitives with browser-spec implementations. Two of those
// implementations break us: its Request strips the Origin header (Hono CORS
// tests), and its AbortSignal/EventTarget aren't recognised by MSW's
// interceptor. Hono's `streamSSE` also needs the WHATWG stream classes
// (Bun's natives have `getWriter` etc.; happy-dom's polyfills don't).
// Stash the natives, register happy-dom, then put the natives back so
// server tests and MSW continue to work.
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
  "TransformStream",
] as const;

const native: Record<string, unknown> = {};
for (const key of nativeKeys) native[key] = (globalThis as Record<string, unknown>)[key];

GlobalRegistrator.register({ url: "http://localhost:5173/" });

for (const [key, value] of Object.entries(native)) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}

// happy-dom doesn't ship an IntersectionObserver — install the test
// double on globalThis so components that observe sentinels can boot
// without throwing. Tests grab the latest instance via the class itself.
Object.defineProperty(globalThis, "IntersectionObserver", {
  value: FakeIntersectionObserver,
  writable: true,
  configurable: true,
});
