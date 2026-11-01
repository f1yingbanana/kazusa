import type { JournalKind, StreamEvent } from "@kazusa/client";

export type EventListener = (event: StreamEvent) => void;

/*
 * OpenClaw can load this plugin more than once in one Gateway process (see
 * `clock/register.ts`). SSE clients attach to the instance serving HTTP, while
 * task and message events may come from an instance loaded for an agent turn,
 * so all instances share one broadcaster and one ledger journal.
 */
const SHARED_REALTIME = Symbol.for("kazusa.realtime");

interface SharedRealtime {
  readonly broadcaster: KazusaRealtimeBroadcaster;
  readonly ledgerRows: Map<string, LedgerJournalRow[]>;
  readonly ledgerLoads: Map<string, Promise<void>>;
  forwardsClock: boolean;
}

function sharedRealtime(): SharedRealtime {
  const scope = globalThis as { [SHARED_REALTIME]?: SharedRealtime };
  return (scope[SHARED_REALTIME] ??= {
    broadcaster: new KazusaRealtimeBroadcaster(),
    ledgerRows: new Map(),
    ledgerLoads: new Map(),
    forwardsClock: false,
  });
}

interface JournalIdentity {
  readonly simTime: number;
  readonly kind: string;
  readonly actors: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

/** What tells one journal event from another, however it was read. */
export function journalKey(event: JournalIdentity): string {
  const { payload } = event;
  // Attention decisions share a task (and, while paused, a sim time); their
  // stimuli tell them apart.
  const entityId =
    (Array.isArray(payload.stimulusIds) ? payload.stimulusIds.join(",") : "") ||
    (typeof payload.taskId === "string" ? payload.taskId : "") ||
    (typeof payload.messageId === "string" ? payload.messageId : "");
  return `${event.kind}:${event.actors.join(",")}:${event.simTime}:${entityId}`;
}

/**
 * Sim time first, so live events sort among history; the rest comes from the
 * event's identity, so the same event gets the same seq live and when reread.
 */
export function withJournalSeq<T extends JournalIdentity>(
  event: T,
): T & { readonly seq: number } {
  let hash = 0x811c9dc5;
  for (const char of journalKey(event))
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return {
    ...event,
    seq: Math.floor(event.simTime) * 1000 + ((hash >>> 0) % 1000),
  };
}

/** A ledger row with structured journal metadata, as the timeline shows it. */
export interface LedgerJournalRow {
  readonly simTime: number;
  readonly kind: JournalKind;
  readonly payload: Record<string, unknown>;
}

/**
 * Each character's ledger rows, so a timeline read need not reopen every
 * transcript: read once per process, then kept current by each append.
 */
export function ledgerJournal(agentId: string): readonly LedgerJournalRow[] {
  return sharedRealtime().ledgerRows.get(agentId) ?? [];
}

export function recordLedgerRows(
  agentId: string,
  rows: readonly LedgerJournalRow[],
): void {
  const all = sharedRealtime().ledgerRows;
  all.set(agentId, [...(all.get(agentId) ?? []), ...rows]);
}

/** Runs `read` until it succeeds once for this character. */
export function loadLedgerJournal(
  agentId: string,
  read: () => Promise<readonly LedgerJournalRow[]>,
): Promise<void> {
  const { ledgerLoads } = sharedRealtime();
  let load = ledgerLoads.get(agentId);
  if (!load) {
    load = read().then(
      (rows) => recordLedgerRows(agentId, rows),
      (error: unknown) => {
        ledgerLoads.delete(agentId);
        throw error;
      },
    );
    ledgerLoads.set(agentId, load);
  }
  return load;
}

export function resetLedgerJournal(): void {
  const { ledgerRows, ledgerLoads } = sharedRealtime();
  ledgerRows.clear();
  ledgerLoads.clear();
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
