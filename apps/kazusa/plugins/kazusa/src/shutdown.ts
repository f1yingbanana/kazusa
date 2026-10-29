const CELL = Symbol.for("kazusa.shutdown");

interface ShutdownCell {
  readonly controller: AbortController;
  listening: boolean;
}

function cell(): ShutdownCell {
  const holder = globalThis as { [CELL]?: ShutdownCell };
  holder[CELL] ??= { controller: new AbortController(), listening: false };
  return holder[CELL];
}

/**
 * Aborts once the Gateway starts to stop: on SIGINT or SIGTERM, or when a
 * handoff is refused because it is draining. Anything frozen on a paused clock
 * lets go then, so a stop never waits on a frozen world: the turn finishes at
 * the paused moment and the Gateway drains cleanly. One per process; OpenClaw's
 * own signal handling is untouched.
 */
export function shutdownSignal(): AbortSignal {
  const shared = cell();
  if (!shared.listening) {
    shared.listening = true;
    const stop = () => noteShutdown("signal");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  return shared.controller.signal;
}

export function noteShutdown(reason: string): void {
  const { controller } = cell();
  if (!controller.signal.aborted)
    controller.abort(new Error(`Gateway stopping (${reason})`));
}
