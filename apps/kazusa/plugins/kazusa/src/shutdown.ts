const CELL = Symbol.for("kazusa.shutdown");

interface ShutdownCell {
  /** This Gateway lifetime's; replaced once a stop has aborted it. */
  controller: AbortController;
  listening: boolean;
}

function cell(): ShutdownCell {
  const holder = globalThis as { [CELL]?: ShutdownCell };
  holder[CELL] ??= { controller: new AbortController(), listening: false };
  return holder[CELL];
}

/**
 * A new plugin registration is a new Gateway lifetime: a restart in the same
 * process registers again before it starts, so the stop of the last one no
 * longer releases the next one's waits.
 */
export function beginGatewayLifetime(): void {
  const shared = cell();
  if (shared.controller.signal.aborted)
    shared.controller = new AbortController();
}

/**
 * Aborts once this Gateway starts to stop or restart, and stays aborted for the
 * rest of that lifetime. Anything frozen on a paused clock lets go then, so a
 * stop never waits on a frozen world: the turn finishes at the paused moment
 * and the Gateway drains cleanly. OpenClaw's own signal handling is untouched.
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

/**
 * Follows the signal OpenClaw hands `gateway_start`: it aborts as soon as a
 * stop or restart drain begins, including a stop through the host's stdin
 * lifeline, which sends no process signal.
 */
export function followGatewayLifetime(signal: AbortSignal | undefined): void {
  if (!signal) return;
  const lifetime = cell().controller;
  const stop = () => {
    if (cell().controller === lifetime) noteShutdown("draining");
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
}
