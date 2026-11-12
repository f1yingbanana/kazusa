import { AsyncLocalStorage } from "node:async_hooks";
import { getEventListeners } from "node:events";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deadlineSignal } from "./deadline.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("a deadline", () => {
  it("aborts with a timeout once the time is up", () => {
    vi.useFakeTimers();
    const deadline = deadlineSignal(1_000);
    vi.advanceTimersByTime(999);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.timedOut()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(true);
    expect(deadline.signal.reason).toMatchObject({ name: "TimeoutError" });
  });

  it("aborts with a parent's reason, which is not a timeout", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = deadlineSignal(1_000, [parent.signal]);
    const reason = new Error("stopping");
    parent.abort(reason);
    expect(deadline.signal.reason).toBe(reason);
    expect(deadline.timedOut()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(deadline.timedOut()).toBe(false);
  });

  it("is aborted from the start under an aborted parent", () => {
    const reason = new Error("already over");
    const deadline = deadlineSignal(1_000, [AbortSignal.abort(reason)]);
    expect(deadline.signal.reason).toBe(reason);
  });

  it("lets go of every parent, whichever way it ends", () => {
    vi.useFakeTimers();
    const listeners = (parent: AbortController): number =>
      getEventListeners(parent.signal, "abort").length;
    const first = new AbortController();
    const second = new AbortController();
    const disposed = deadlineSignal(1_000, [first.signal, second.signal]);
    expect([listeners(first), listeners(second)]).toEqual([1, 1]);
    disposed.dispose();
    expect([listeners(first), listeners(second)]).toEqual([0, 0]);

    deadlineSignal(1_000, [first.signal, second.signal]);
    vi.advanceTimersByTime(1_000);
    expect([listeners(first), listeners(second)]).toEqual([0, 0]);

    // A later parent that is already aborted: the earlier one is let go too.
    deadlineSignal(1_000, [first.signal, AbortSignal.abort()]);
    expect(listeners(first)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    deadlineSignal(1_000, [first.signal, second.signal]);
    second.abort();
    expect(listeners(first)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never fires once disposed, whatever the parent does later", () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = deadlineSignal(1_000, [parent.signal]);
    deadline.dispose();
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5_000);
    parent.abort();
    expect(deadline.signal.aborted).toBe(false);
  });

  /*
   * What `AbortSignal.any([parent, AbortSignal.timeout(ms)])` got wrong: its
   * timer fired with a listener still on the signal, so Node kept the signal,
   * and with it the async context of whoever had asked, for as long as the
   * parent lived.
   */
  it("lets go of the caller once the work is over", async () => {
    setFlagsFromString("--expose-gc");
    const collect = runInNewContext("gc") as () => void;
    const storage = new AsyncLocalStorage<object>();
    const lifetime = new AbortController();
    let alive = 0;
    const registry = new FinalizationRegistry(() => {
      alive -= 1;
    });
    const work = async (): Promise<void> => {
      const deadline = deadlineSignal(5, [lifetime.signal]);
      // Whoever is handed the signal may leave a listener on it: with
      // OpenClaw's guarded fetch, one was still there when the timer fired.
      deadline.signal.addEventListener("abort", () => undefined);
      try {
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        deadline.dispose();
      }
    };
    const RUNS = 20;
    for (let run = 0; run < RUNS; run += 1) {
      const context = { run };
      registry.register(context, undefined);
      alive += 1;
      await storage.run(context, work);
    }
    // Past every deadline: a timer left running would have fired by now.
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (let round = 0; round < 10 && alive > 2; round += 1) {
      collect();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // The last context or two may still be on the stack.
    expect(alive).toBeLessThanOrEqual(2);
  });
});
