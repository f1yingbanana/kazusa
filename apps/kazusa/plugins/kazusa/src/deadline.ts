/** A deadline for work that ends; `dispose` it when the work is over. */
export interface Deadline {
  /** Aborts when a parent does, or once the time is up. */
  readonly signal: AbortSignal;
  /** Whether the time ran out, rather than a parent aborting. */
  readonly timedOut: () => boolean;
  /**
   * Stops the timer and lets go of the parents: the signal never aborts after
   * this, so call it only once nothing still waits on the signal. Safe to call
   * twice.
   */
  readonly dispose: () => void;
}

/**
 * A signal that aborts when a parent does or after `ms`. Use this instead of
 * `AbortSignal.any([parent, AbortSignal.timeout(ms)])` for anything that
 * finishes. That timer can't be cancelled, so it always fires, and Node keeps a
 * combined signal alive (its `gcPersistentSignals`) when a listener that isn't
 * `once` is still on it as it aborts and one of its sources outlives it: here,
 * as long as the Gateway runs. The abort reason holds the stack of the timer
 * that fired, and so the async context of whoever asked. Live, every decision
 * made inside a brain run kept that run and its whole transcript in memory,
 * about 1 MB a model call, until the Gateway ran out of heap.
 */
export function deadlineSignal(
  ms: number,
  parents: readonly AbortSignal[] = [],
): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const release: Array<() => void> = [];
  // Before `dispose`, which reads it: a parent may be aborted already.
  const timer = setTimeout(() => {
    timedOut = true;
    abort(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
  }, ms);
  // Like `AbortSignal.timeout`, a deadline never keeps the process running.
  timer.unref();
  const dispose = (): void => {
    clearTimeout(timer);
    for (const undo of release.splice(0)) undo();
  };
  const abort = (reason: unknown): void => {
    dispose();
    controller.abort(reason);
  };
  for (const parent of parents) {
    if (parent.aborted) {
      abort(parent.reason);
      break;
    }
    const onAbort = (): void => abort(parent.reason);
    parent.addEventListener("abort", onAbort, { once: true });
    release.push(() => parent.removeEventListener("abort", onAbort));
  }
  return { signal: controller.signal, timedOut: () => timedOut, dispose };
}
