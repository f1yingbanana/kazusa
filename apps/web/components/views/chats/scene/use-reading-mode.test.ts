// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readingStatus, useReadingClock } from "./use-reading-mode";

/**
 * A fake clock: records each `set_speed`, shown on the next render; while
 * `failing`, each is refused and the speed stays.
 */
function harness(initialSpeed: number | undefined) {
  const clock = {
    speed: initialSpeed,
    calls: [] as number[],
    leaving: [] as number[],
    failing: false,
  };
  const setSpeed = (speed: number, leaving = false) => {
    (leaving ? clock.leaving : clock.calls).push(speed);
    if (clock.failing) return Promise.resolve(false);
    clock.speed = speed;
    return Promise.resolve(true);
  };
  const takenBack = vi.fn();
  let props = { on: false, waiting: 0 };
  const view = renderHook(
    (p: typeof props) =>
      useReadingClock({
        ...p,
        clock: { speed: clock.speed, setSpeed },
        onTakenBack: takenBack,
      }),
    { initialProps: props },
  );
  const set = (next: Partial<typeof props>) => {
    props = { ...props, ...next };
    view.rerender(props);
    view.rerender(props);
  };
  const elsewhere = (speed: number) => {
    clock.speed = speed;
    view.rerender(props);
  };
  return { clock, takenBack, set, elsewhere, view };
}

afterEach(cleanup);

describe("reading mode's clock, bound", () => {
  it("pauses while a line waits and runs again, at the speed found, once read", () => {
    const h = harness(10);
    h.set({ on: true });
    expect(h.clock.calls).toEqual([]);
    h.set({ waiting: 1 });
    h.set({ waiting: 3 });
    expect(h.clock.calls).toEqual([0]);
    h.set({ waiting: 0 });
    expect(h.clock.calls).toEqual([0, 10]);
  });

  it("starts a paused world at 1x, and pauses it again when turned off", () => {
    const h = harness(0);
    h.set({ on: true });
    expect(h.clock.calls).toEqual([1]);
    h.set({ on: false });
    expect(h.clock.calls).toEqual([1, 0]);
  });

  it("holds the world through a send, then lets it run", () => {
    const h = harness(10);
    h.set({ on: true, waiting: 2 });
    let sent = () => {};
    act(() => {
      sent = h.view.result.current.send();
    });
    h.set({ waiting: 0 });
    expect(h.clock.calls).toEqual([0]);
    act(() => sent());
    expect(h.clock.calls).toEqual([0, 10]);
  });

  it.each<[string, (h: ReturnType<typeof harness>) => void]>([
    ["turned off", (h) => h.set({ on: false })],
    ["unmounted (the chat left)", (h) => h.view.unmount()],
  ])("puts back the speed found when %s", (_, end) => {
    const h = harness(10);
    h.set({ on: true, waiting: 1 });
    end(h);
    expect(h.clock.calls).toEqual([0, 10]);
  });

  it("puts it back with a call that outlives the page as it is left", () => {
    const h = harness(10);
    h.set({ on: true, waiting: 1 });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(h.clock.leaving).toEqual([10]);
    h.set({ on: false });
    expect(h.clock.calls).toEqual([0]);
  });

  it("sets a speed that failed again later, and puts back the speed found when off", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(10);
      h.set({ on: true, waiting: 1 });
      h.clock.failing = true;
      h.set({ waiting: 0 });
      await act(async () => {});
      expect(h.clock.speed).toBe(0);
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(h.clock.calls).toEqual([0, 10, 10]);
      h.clock.failing = false;
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(h.clock.calls).toEqual([0, 10, 10, 10]);
      expect(h.clock.speed).toBe(10);
      // Failed again: turned off, it still puts back the speed found.
      h.set({ waiting: 1 });
      h.clock.failing = true;
      h.set({ waiting: 0 });
      await act(async () => {});
      h.clock.failing = false;
      h.set({ on: false });
      expect(h.clock.calls).toEqual([0, 10, 10, 10, 0, 10, 10]);
      expect(h.clock.speed).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets go when the page comes back from the back-forward cache", () => {
    const h = harness(10);
    h.set({ on: true, waiting: 1 });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(
        Object.assign(new Event("pageshow"), { persisted: true }),
      );
    });
    expect(h.clock.leaving).toEqual([10]);
    expect(h.takenBack).toHaveBeenCalledTimes(1);
  });

  it("does not let a reply sent before it was turned off and on end a hold", () => {
    const h = harness(10);
    h.set({ on: true, waiting: 1 });
    let before = () => {};
    let now = () => {};
    act(() => {
      before = h.view.result.current.send();
    });
    h.set({ on: false });
    h.set({ on: true });
    act(() => {
      now = h.view.result.current.send();
    });
    h.set({ waiting: 0 });
    act(() => before());
    expect(h.clock.calls).toEqual([0, 10, 0]);
    act(() => now());
    expect(h.clock.calls).toEqual([0, 10, 0, 10]);
  });

  it("lets go when someone else sets the speed, and not for a late echo of its own", () => {
    const h = harness(10);
    h.set({ on: true, waiting: 1 });
    h.set({ waiting: 0 });
    // Its pause's news arrives after its resume's.
    h.elsewhere(0);
    h.elsewhere(10);
    expect(h.takenBack).not.toHaveBeenCalled();
    h.elsewhere(60);
    expect(h.takenBack).toHaveBeenCalledTimes(1);
    h.set({ on: false });
    expect(h.clock.calls).toEqual([0, 10]);
  });
});

describe("reading mode's word at the panel's corner", () => {
  it.each([
    [1, true, { speaking: "b" }, { kind: "ready" }],
    [0, false, { speaking: "b" }, { kind: "none" }],
    [0, true, { speaking: "b", thinking: "c" }, { kind: "speaking", id: "b" }],
    [0, true, { thinking: "c" }, { kind: "thinking", id: "c" }],
    [0, true, {}, { kind: "waiting" }],
  ] as const)(
    "%i waiting, asked %s, %j → %j",
    (waiting, wanted, activity, status) => {
      expect(readingStatus(waiting, wanted, activity)).toEqual(status);
    },
  );
});
