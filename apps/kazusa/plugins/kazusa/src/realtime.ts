import type { StreamEvent } from "@kazusa/client";

export type EventListener = (event: StreamEvent) => void;

/*
 * OpenClaw can load this plugin more than once in one Gateway process (see
 * `clock/register.ts`). SSE clients attach to the instance serving HTTP, while
 * task and message events may come from an instance loaded for an agent turn,
 * so all instances share one broadcaster and one journal sequence.
 */
const SHARED_REALTIME = Symbol.for("kazusa.realtime");

interface SharedRealtime {
  readonly broadcaster: KazusaRealtimeBroadcaster;
  journalSeq: number;
  forwardsClock: boolean;
}

function sharedRealtime(): SharedRealtime {
  const scope = globalThis as { [SHARED_REALTIME]?: SharedRealtime };
  return (scope[SHARED_REALTIME] ??= {
    broadcaster: new KazusaRealtimeBroadcaster(),
    journalSeq: 1,
    forwardsClock: false,
  });
}

export function nextJournalSeq(): number {
  return sharedRealtime().journalSeq++;
}

/** The process-wide broadcaster every plugin instance publishes through. */
export function sharedBroadcaster(): KazusaRealtimeBroadcaster {
  return sharedRealtime().broadcaster;
}

/**
 * Runs `forward` once per process. Clock listeners are shared too, so one
 * forwarder sees every change; a second would publish each change twice.
 */
export function forwardClockOnce(forward: () => void): void {
  const shared = sharedRealtime();
  if (shared.forwardsClock) return;
  shared.forwardsClock = true;
  forward();
}

/** In-process observer event broadcaster for Kazusa read-model SSE clients. */
export class KazusaRealtimeBroadcaster {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  broadcast(event: StreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Do not let a broken subscriber affect other subscribers
      }
    }
  }
}
