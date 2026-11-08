// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import { useRecentEvents } from "./use-timeline";
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
