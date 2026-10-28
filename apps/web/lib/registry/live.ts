import type { StreamEvent, StreamEventType } from "@kazusa/client";
import { appendToTail } from "@/lib/live/journal";
import {
  clockStore,
  desireStore,
  journalTailStore,
  statusStore,
} from "@/lib/live/state";
import type { LiveHandler } from "./types";

export interface LiveContext {
  readonly statuses: typeof statusStore;
  readonly clock: typeof clockStore;
  readonly journalTail: typeof journalTailStore;
  readonly desires: typeof desireStore;
  /** Called when a journal seq gap is detected; catch up with `timeline?after=`. */
  readonly onJournalGap?: (after: number) => void;
}

export const defaultLiveContext: LiveContext = {
  statuses: statusStore,
  clock: clockStore,
  journalTail: journalTailStore,
  desires: desireStore,
};

/*
 * Observer-scope handlers. Player-scope chat events (`message`, `typing`,
 * `chats`, `connected`) are still applied inside `RealtimeProvider`; moving
 * them here is on the roadmap.
 */
export const LIVE_HANDLERS: { [T in StreamEventType]?: LiveHandler<T> } = {
  status: (event, ctx) => ctx.statuses.set(event.characterId, event.status),
  journal: (event, ctx) => {
    const current = ctx.journalTail.get();
    const { tail, gapAfter } = appendToTail(
      current,
      event.event,
      current.at(-1)?.seq,
    );
    ctx.journalTail.set(tail);
    if (gapAfter !== undefined) ctx.onJournalGap?.(gapAfter);
  },
  clock: (event, ctx) => ctx.clock.set({ clock: event.clock, offset: 0 }),
  desires: (event, ctx) => {
    // Anchors only move forward, so an older record (a late snapshot) loses.
    const current = ctx.desires.get(event.characterId);
    if (current && current.anchorAt > event.record.anchorAt) return;
    ctx.desires.set(event.characterId, event.record);
  },
};

export function dispatchLive(
  event: StreamEvent,
  ctx: LiveContext = defaultLiveContext,
) {
  const handler = LIVE_HANDLERS[event.type] as
    | ((event: StreamEvent, ctx: LiveContext) => void)
    | undefined;
  handler?.(event, ctx);
}
