import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RunListEntry, RunsPage } from "../api.ts";
import { useRunFeed } from "./use-run-feed.ts";

afterEach(() => cleanup());

const stubRun = (id: string, workflowName = "wf"): RunListEntry => ({
  id,
  workflowName,
  status: "ok",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: "2026-05-09T12:00:01.000Z",
  error: null,
  summary: null,
  definitionSnapshot: { name: workflowName, steps: [] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendationsCount: 0,
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

  it("prepends a new run to page one without re-fetching", async () => {
    const fetchPage = async () =>
      ({ runs: [stubRun("r1"), stubRun("r2")], nextCursor: null }) satisfies RunsPage;
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.prependRun(stubRun("r0", "fresh")));

    expect(result.current.runs.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    expect(result.current.pages[0]?.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
  });

  it("prepending a run that's already loaded patches it in place", async () => {
    const fetchPage = async () =>
      ({ runs: [stubRun("r1", "old-name"), stubRun("r2")], nextCursor: null }) satisfies RunsPage;
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.prependRun(stubRun("r1", "new-name")));

    // No duplicate; r1 patched in place at its original position.
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.current.runs[0]?.workflowName).toBe("new-name");
  });

  it("prepending into an empty feed produces a single-row first page", async () => {
    const fetchPage = async () => ({ runs: [], nextCursor: null }) satisfies RunsPage;
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.prependRun(stubRun("r1")));

    expect(result.current.runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("patches a loaded run wherever it sits in the pages", async () => {
    const fetchPage = async (opts: { cursor?: string; limit?: number }): Promise<RunsPage> => {
      if (opts.cursor === undefined) {
        return { runs: [stubRun("r1"), stubRun("r2")], nextCursor: "r2" };
      }
      return { runs: [stubRun("r3", "deep")], nextCursor: null };
    };
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Patch a row in page two (the one we just appended).
    act(() => result.current.patchRun(stubRun("r3", "deep-patched")));

    expect(result.current.runs.find((r) => r.id === "r3")?.workflowName).toBe("deep-patched");
    expect(result.current.pages[1]?.map((r) => r.id)).toEqual(["r3"]);
  });

  it("patchRun is a no-op when the run isn't on any loaded page", async () => {
    const fetchPage = async () => ({ runs: [stubRun("r1")], nextCursor: null }) satisfies RunsPage;
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const before = result.current.runs;
    act(() => result.current.patchRun(stubRun("not-loaded")));

    expect(result.current.runs).toEqual(before);
  });

  it("removes a loaded run wherever it sits in the pages", async () => {
    const fetchPage = async (opts: { cursor?: string; limit?: number }): Promise<RunsPage> => {
      if (opts.cursor === undefined) {
        return { runs: [stubRun("r1"), stubRun("r2")], nextCursor: "r2" };
      }
      return { runs: [stubRun("r3"), stubRun("r4")], nextCursor: null };
    };
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Drop a row in page two; the row in page one (r2) stays put.
    act(() => result.current.removeRun("r3"));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2", "r4"]);
    expect(result.current.pages[1]?.map((r) => r.id)).toEqual(["r4"]);

    // Drop a row in page one; pages below remain intact.
    act(() => result.current.removeRun("r1"));
    expect(result.current.runs.map((r) => r.id)).toEqual(["r2", "r4"]);
    expect(result.current.pages[0]?.map((r) => r.id)).toEqual(["r2"]);
  });

  it("removeRun is a no-op when the run isn't on any loaded page", async () => {
    const fetchPage = async () => ({ runs: [stubRun("r1")], nextCursor: null }) satisfies RunsPage;
    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const before = result.current.runs;
    act(() => result.current.removeRun("not-loaded"));

    expect(result.current.runs).toEqual(before);
  });

  it("mergePageOne replaces page one and dedupes against deeper pages", async () => {
    let call = 0;
    const fetchPage = async (opts: { cursor?: string; limit?: number }): Promise<RunsPage> => {
      call++;
      if (opts.cursor === undefined && call === 1) {
        return { runs: [stubRun("r1"), stubRun("r2")], nextCursor: "r2" };
      }
      if (opts.cursor === "r2") {
        // r2 also appears here on purpose — exercise dedup against the
        // fresh page one re-merge. Deeper cursor stays non-null so we
        // can also assert that the merge leaves it intact.
        return { runs: [stubRun("r2"), stubRun("r3")], nextCursor: "r3" };
      }
      // Merge: fresh r0 at top, r1 already known, r2 also known.
      return { runs: [stubRun("r0"), stubRun("r1"), stubRun("r2")], nextCursor: "r2" };
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.loadNext());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // r2 appears once in page one and once in page two — page two's
    // copy is the "stale" duplicate the merge should drop.
    expect(result.current.runs.map((r) => r.id)).toEqual(["r1", "r2", "r2", "r3"]);

    act(() => result.current.mergePageOne());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.runs.map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3"]);
    // Deeper-page cursor still anchors the next loadNext.
    expect(result.current.nextCursor).toBe("r3");
  });

  it("mergePageOne updates nextCursor when only one page is loaded", async () => {
    let call = 0;
    const fetchPage = async (): Promise<RunsPage> => {
      call++;
      if (call === 1) return { runs: [stubRun("r1")], nextCursor: null };
      return { runs: [stubRun("r0"), stubRun("r1")], nextCursor: "r1" };
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.endReached).toBe(true);

    act(() => result.current.mergePageOne());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.runs.map((r) => r.id)).toEqual(["r0", "r1"]);
    // A new page-one cursor reopens the feed.
    expect(result.current.nextCursor).toBe("r1");
    expect(result.current.endReached).toBe(false);
  });

  it("mergePageOne into an empty hook just loads page one", async () => {
    const first = deferred<RunsPage>();
    const second = deferred<RunsPage>();
    let call = 0;
    const fetchPage = async (): Promise<RunsPage> => {
      call++;
      return call === 1 ? first.promise : second.promise;
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));

    // Trigger mergePageOne before the initial page lands so we exercise
    // the prev.length === 0 branch.
    act(() => result.current.mergePageOne());

    await act(async () => {
      first.resolve({ runs: [stubRun("ignored")], nextCursor: null });
      second.resolve({ runs: [stubRun("r1")], nextCursor: null });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("captures mergePageOne fetch errors into the error slot", async () => {
    let call = 0;
    const fetchPage = async (): Promise<RunsPage> => {
      call++;
      if (call === 1) return { runs: [stubRun("r1")], nextCursor: null };
      throw new Error("merge boom");
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.mergePageOne());
    await waitFor(() => expect(result.current.error?.message).toBe("merge boom"));
  });

  it("mergePageOne fired during an in-flight follow-on page cancels the stale resolution", async () => {
    const followOn = deferred<RunsPage>();
    let call = 0;
    const fetchPage = async (opts: { cursor?: string; limit?: number }): Promise<RunsPage> => {
      call++;
      if (call === 1) return { runs: [stubRun("r1")], nextCursor: "r1" };
      if (opts.cursor === "r1") return followOn.promise;
      return { runs: [stubRun("r0"), stubRun("r1")], nextCursor: "r1" };
    };

    const { result } = renderHook(() => useRunFeed({ fetchPage }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.loadNext());
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.mergePageOne());
    await waitFor(() => expect(result.current.runs.map((r) => r.id)).toEqual(["r0", "r1"]));

    await act(async () => {
      followOn.resolve({ runs: [stubRun("r2")], nextCursor: null });
    });
    expect(result.current.runs.map((r) => r.id)).toEqual(["r0", "r1"]);
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
