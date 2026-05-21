import { act } from "@testing-library/react";

/**
 * Flush pending on-mount fetches — and the React state updates they
 * trigger — inside `act()`. Several page-shell surfaces (workflows nav,
 * version footer, recently-published rail) and route views fetch
 * independently on mount; a test that renders them but asserts
 * synchronously must await this so those resolutions don't land as
 * act-unwrapped state updates after the test body has finished.
 */
export const flushAsync = async (): Promise<void> => {
  await act(async () => {
    // Each iteration yields one macrotask — enough drains for the
    // fetch → json → setState chains (and any chained refetch) to settle.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};
