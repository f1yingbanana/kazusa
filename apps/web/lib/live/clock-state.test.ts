// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClock, sampleClock, useClockStore } from "./clock-state";
import {
  setStatuses,
  updateStatuses,
  useLiveStore,
  type LiveState,
} from "./state";
import { dispatchLive } from "../registry/live";
import { useSimNow } from "../../hooks/use-clock";

beforeEach(() => {
  useClockStore.setState(useClockStore.getInitialState(), true);
  useLiveStore.setState(useLiveStore.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isolated simulation clock", () => {
  it("renders time at each subscriber's resolution and responds immediately to pause/advance", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setClock({
      clock: { simTime: 60_000, speed: 1, updatedAt: Date.now() },
      offset: 0,
    });
    const minuteRender = vi.fn();
    const { result } = renderHook(() => {
      minuteRender();
      return useSimNow();
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
      sampleClock();
    });
    expect(result.current).toBe(60_000);
    expect(minuteRender).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(59_000);
      sampleClock();
    });
    expect(result.current).toBe(120_000);
    act(() =>
      dispatchLive({
        type: "clock",
        clock: { simTime: 180_000, speed: 0, updatedAt: Date.now() },
      }),
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
      sampleClock();
    });
    expect(result.current).toBe(180_000);
    expect(minuteRender).toHaveBeenCalledTimes(3);
  });

  it("preserves server clock offset on SSE and avoids paused clock notifications", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    setClock({
      clock: { simTime: 60_000, speed: 1, updatedAt: 6000 },
      offset: 5000,
    });
    dispatchLive({
      type: "clock",
      clock: { simTime: 90_000, speed: 1, updatedAt: 6000 },
    });
    expect(useClockStore.getState().simNow).toBe(90_000);
    dispatchLive({
      type: "clock",
      clock: { simTime: 90_000, speed: 0, updatedAt: 6000 },
    });
    const listener = vi.fn();
    const unsubscribe = useClockStore.subscribe(listener);
    vi.advanceTimersByTime(1000);
    sampleClock();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
  it("does not evaluate 300 entity selectors or status aggregates on a clock tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const idle = {
      brain: "idle" as const,
      composingIn: [],
      queued: 0,
      onstage: true,
    };
    setStatuses(
      Array.from({ length: 300 }, (_, index) => [String(index), idle] as const),
    );
    setClock({
      clock: { simTime: 60_000, speed: 1, updatedAt: Date.now() },
      offset: 0,
    });
    const selectors = Array.from({ length: 300 }, (_, index) =>
      vi.fn((state: LiveState) => state.statuses.get(String(index))),
    );
    const aggregate = vi.fn(
      (state: LiveState) =>
        [...state.statuses.values()].filter(
          (status) => status.brain === "thinking",
        ).length,
    );
    function Character({ index }: { readonly index: number }) {
      const status = useLiveStore(selectors[index]);
      return createElement("span", null, status?.brain);
    }
    render(
      createElement(
        Fragment,
        null,
        ...selectors.map((_, index) =>
          createElement(Character, { key: index, index }),
        ),
      ),
    );
    const count = renderHook(() => useLiveStore(aggregate));
    const time = renderHook(() => useSimNow(1000));
    for (const selector of selectors) selector.mockClear();
    aggregate.mockClear();

    act(() => {
      vi.advanceTimersByTime(1000);
      sampleClock();
    });
    expect(time.result.current).toBe(61_000);
    expect(
      selectors.every((selector) => selector.mock.calls.length === 0),
    ).toBe(true);
    expect(aggregate).not.toHaveBeenCalled();

    act(() => updateStatuses([["0", { ...idle, brain: "thinking" }]]));
    expect(selectors[0]).toHaveBeenCalled();
    expect(count.result.current).toBe(1);
  });
});
