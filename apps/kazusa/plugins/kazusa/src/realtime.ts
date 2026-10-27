import type { StreamEvent } from "@kazusa/client";

export type EventListener = (event: StreamEvent) => void;

let globalJournalSeq = 1;
export function nextJournalSeq(): number {
  return globalJournalSeq++;
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
