/**
 * Test double for the browser's `IntersectionObserver`. happy-dom doesn't
 * ship one. The shim records every construction so tests can grab the
 * latest observer and drive intersections with `triggerIntersect()`.
 *
 * happy-dom.ts installs this class as `globalThis.IntersectionObserver`
 * for the test environment; tests reset `FakeIntersectionObserver.instances`
 * in their `afterEach` to keep state from leaking across tests.
 */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }

  /**
   * Drive the registered callback as if every currently-observed element
   * had crossed the viewport threshold. Tests use this to simulate a
   * scroll bringing the sentinel into view.
   */
  triggerIntersect(isIntersecting = true): void {
    const entries = [...this.observed].map((target) => ({
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    })) as IntersectionObserverEntry[];
    this.callback(entries, this as unknown as IntersectionObserver);
  }

  /** Most recently constructed instance, or undefined if none yet. */
  static latest(): FakeIntersectionObserver | undefined {
    return FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
  }

  /** Reset the per-test capture array. Call in `afterEach`. */
  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }
}
