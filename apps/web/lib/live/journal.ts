import type { JournalEvent } from "@kazusa/client";

export const TAIL_LIMIT = 500;

/**
 * Appends a live journal event to the ascending tail. Duplicates are ignored.
 * `gapAfter` is set when `seq` skips ahead of the last seen seq, so the caller
 * can catch up with `GET /kazusa/timeline?after=<gapAfter>`.
 */
export function appendToTail(
  tail: readonly JournalEvent[],
  event: JournalEvent,
  lastSeq: number | undefined,
  limit = TAIL_LIMIT,
): { tail: readonly JournalEvent[]; gapAfter?: number } {
  if (tail.some((existing) => existing.seq === event.seq)) return { tail };
  const next = [...tail, event].sort((a, b) => a.seq - b.seq).slice(-limit);
  const gapAfter =
    lastSeq !== undefined && event.seq > lastSeq + 1 ? lastSeq : undefined;
  return { tail: next, gapAfter };
}

/** Merges tail (ascending) and history pages (newest-first) into newest-first, unique by seq. */
export function mergeNewestFirst(
  tail: readonly JournalEvent[],
  history: readonly JournalEvent[],
) {
  const seen = new Set<number>();
  const merged: JournalEvent[] = [];
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const event = tail[index];
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    merged.push(event);
  }
  for (const event of history) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    merged.push(event);
  }
  return merged.sort((a, b) => b.seq - a.seq);
}
