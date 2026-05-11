import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RunListEntry, RunsPage } from "../api.ts";
import { useRunFeed } from "./use-run-feed.ts";

afterEach(() => cleanup());

const stubRun = (id: string, workflowName = "wf"): RunListEntry => ({
  id,
  workflowName,
  status: "ok",
  trigger: "manual",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: workflowName, steps: [] },
  isInterrupted: false,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useRunFeed", () => {
  it("loads page one on mount and exposes flattened runs", async () => {
    const fetchPage = async () =>
      ({ runs: [stubRun("r1"), stubRun("r2")], nextCursor: null }) satisfies RunsPage;
    const { result } = renderHook(() => useRunFeed({ fetchPage }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.current.endReached).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("appends subsequent pages on loadNext and exposes the new cursor", async () => {
    const calls: ({ cursor?: string; limit?: number } | undefined)[] = [];
    const pages: Record<string, RunsPage> = {
      first: { runs: [stubRun("r1"), stubRun("r2")], nextCursor: "r2" },
      r2: { runs: [stubRun("r3"), stubRun("r4")], nextCursor: "r4" },
      r4: { runs: [stubRun("r5")], nextCursor: null },
    };
    const fetchPage = async (opts: { cursor?: string; limit?: number }) => {
      calls.push(opts);
      const key = opts.cursor ?? "first";
      return pages[key];
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.current.nextCursor).toBe("r2");
    expect(result.current.endReached).toBe(false);

    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(result.current.nextCursor).toBe("r4");

    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(result.current.endReached).toBe(true);

    expect(calls.map((c) => c?.cursor)).toEqual([undefined, "r2", "r4"]);
  });

  it("coalesces concurrent loadNext calls while a fetch is in flight", async () => {
    const firstPage = deferred<RunsPage>();
    const secondPage = deferred<RunsPage>();
    let call = 0;
    const fetchPage = async (): Promise<RunsPage> => {
      call++;
      if (call === 1) return firstPage.promise;
      return secondPage.promise;
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));

    // Resolve the initial page so a cursor exists and loadNext is meaningful.
    await act(async () => {
      firstPage.resolve({ runs: [stubRun("r1")], nextCursor: "r1" });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Fire loadNext repeatedly while page two is still pending.
    act(() => {
      result.current.loadNext();
      result.current.loadNext();
      result.current.loadNext();
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      secondPage.resolve({ runs: [stubRun("r2")], nextCursor: null });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Only one network request beyond the initial page despite three calls.
    expect(call).toBe(2);
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("is a no-op when loadNext is called after the feed has ended", async () => {
    let call = 0;
    const fetchPage = async (): Promise<RunsPage> => {
      call++;
      return { runs: [stubRun("r1")], nextCursor: null };
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(call).toBe(1);

    act(() => {
      result.current.loadNext();
      result.current.loadNext();
    });

    expect(call).toBe(1);
    expect(result.current.endReached).toBe(true);
  });

  it("captures fetch errors into the error slot", async () => {
    const fetchPage = async () => {
      throw new Error("boom");
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.runs).toEqual([]);
  });

  it("surfaces follow-on page errors without losing the loaded first page", async () => {
    let call = 0;
    const fetchPage = async (): Promise<RunsPage> => {
      call++;
      if (call === 1) return { runs: [stubRun("r1")], nextCursor: "r1" };
      throw new Error("page two boom");
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.error?.message).toBe("page two boom"));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("refresh discards loaded pages and re-fetches page one", async () => {
    let call = 0;
    const fetchPage = async (opts: { cursor?: string; limit?: number }): Promise<RunsPage> => {
      call++;
      if (opts.cursor === undefined && call === 1) {
        return { runs: [stubRun("r1"), stubRun("r2")], nextCursor: "r2" };
      }
      if (opts.cursor === "r2") {
        return { runs: [stubRun("r3")], nextCursor: null };
      }
      // refresh: a fresh r0 has appeared at the top.
      return { runs: [stubRun("r0"), stubRun("r1"), stubRun("r2")], nextCursor: "r2" };
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Page two is gone after refresh; only the new first page remains.
    expect(result.current.runs.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    expect(result.current.nextCursor).toBe("r2");
  });

  it("refresh fired during an in-flight follow-on page discards the stale resolution", async () => {
    const followOn = deferred<RunsPage>();
    let call = 0;
    const fetchPage = async (opts: { cursor?: string; limit?: number }): Promise<RunsPage> => {
      call++;
      if (call === 1) return { runs: [stubRun("r1")], nextCursor: "r1" };
      if (opts.cursor === "r1") return followOn.promise;
      // refresh hits this third call.
      return { runs: [stubRun("rA")], nextCursor: null };
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadNext());
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.runs.map((r) => r.id)).toEqual(["rA"]));

    // Late follow-on resolution must not append after the refresh.
    await act(async () => {
      followOn.resolve({ runs: [stubRun("r2")], nextCursor: null });
    });
    expect(result.current.runs.map((r) => r.id)).toEqual(["rA"]);
  });

  it("ignores a resolution that lands after the hook unmounts", async () => {
    const first = deferred<RunsPage>();
    const fetchPage = async () => first.promise;

    const { unmount } = renderHook(() => useRunFeed({ fetchPage }));
    unmount();

    // Resolving after unmount must not throw or update React state.
    await act(async () => {
      first.resolve({ runs: [stubRun("r1")], nextCursor: null });
    });
  });
});
