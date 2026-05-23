import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { FakeIntersectionObserver } from "./fake-intersection-observer.ts";

// happy-dom registers DOM globals (window, document, navigator, …) but also
// replaces fetch primitives with browser-spec implementations. Three of those
// implementations break us: its Request strips the Origin header (Hono CORS
// tests), its AbortSignal/EventTarget aren't recognised by MSW's
// interceptor, and Hono's `streamSSE` needs the WHATWG stream classes
// (Bun's natives have `getWriter` etc.; happy-dom's polyfills don't). Stash
// the natives, register happy-dom, then put the natives back so server
// tests and MSW continue to work.
//
// `Event` and `MessageEvent` stay as happy-dom's classes: happy-dom's
// EventTarget.dispatchEvent does an `instanceof Event` check against its
// own Event class, and component tests that drive DOM nodes (via
// @testing-library/user-event, fireEvent, etc.) construct events from
// `globalThis.Event`. If we restored native Event, every keystroke or
// blur would fail that check. MSW's interceptor operates on its own
// native AbortSignal — not on DOM nodes — so it doesn't touch this path.
const nativeKeys = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "AbortController",
  "AbortSignal",
  "EventTarget",
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
