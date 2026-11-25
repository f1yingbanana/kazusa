// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import { useRecentEvents, useTimeline } from "./use-timeline";
import { mergeJournal, useLiveStore } from "../lib/live/state";
import { fetchTimeline } from "../lib/source/timeline/http";

vi.mock("../lib/source/provider", () => ({
  useSources: () => ({ resolved: { timeline: "live" } }),
}));
vi.mock("../lib/source/timeline/http", () => ({ fetchTimeline: vi.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    SWRConfig,
    {
      value: {
        provider: () => new Map(),
        dedupingInterval: 0,
        errorRetryCount: 0,
      },
    },
    children,
  );
}

afterEach(() => {
  cleanup();
  useLiveStore.setState(useLiveStore.getInitialState(), true);
});

it("includes live events when recent events has no kind filter", async () => {
  vi.mocked(fetchTimeline).mockResolvedValue({ events: [], hasMore: false });
  const { result } = renderHook(() => useRecentEvents("alice", 3, []), {
    wrapper,
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  act(() =>
    mergeJournal([
      {
        seq: 1,
        simTime: 0,
        kind: "task.started",
        actors: ["alice"],
        payload: {
          taskId: "task",
          type: "work",
          description: "Working",
          duration: 30,
          endAt: 30,
        },
      },
    ]),
  );
  expect(result.current.events.map((event) => event.seq)).toEqual([1]);
});

it("keeps previous events visible without re-entering skeleton loading when filters change", async () => {
  const firstEvent = {
    seq: 10,
    simTime: 1000,
    kind: "task.started" as const,
    actors: ["alice"],
    payload: {
      taskId: "t1",
      type: "work",
      description: "First",
      duration: 15,
      endAt: 1015,
    },
  };
  let resolveSecond!: (value: { events: []; hasMore: false }) => void;
  vi.mocked(fetchTimeline)
    .mockResolvedValueOnce({ events: [firstEvent], hasMore: false })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

  const { result, rerender } = renderHook(
    ({ actors }: { actors: string[] }) => useTimeline({ actors }),
    { initialProps: { actors: ["alice"] }, wrapper },
  );

  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.events.map((e) => e.seq)).toEqual([10]);

  rerender({ actors: ["bob"] });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isSwitching).toBe(true);
  expect(result.current.events.map((e) => e.seq)).toEqual([10]);

  await act(async () => {
    resolveSecond({ events: [], hasMore: false });
  });
  await waitFor(() => expect(result.current.isSwitching).toBe(false));
  expect(result.current.events).toEqual([]);
});

it("skips fetching and returns no events when disabled", async () => {
  vi.mocked(fetchTimeline).mockClear();
  mergeJournal([
    {
      seq: 20,
      simTime: 2000,
      kind: "task.started",
      actors: ["alice"],
      payload: {
        taskId: "t2",
        type: "work",
        description: "Hidden",
        duration: 15,
        endAt: 2015,
      },
    },
  ]);

  const { result } = renderHook(
    () => useTimeline({ actors: [], enabled: false }),
    { wrapper },
  );

  expect(fetchTimeline).not.toHaveBeenCalled();
  expect(result.current.events).toEqual([]);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.hasMore).toBe(false);
});
