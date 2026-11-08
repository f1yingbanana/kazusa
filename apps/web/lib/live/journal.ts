import type { JournalEvent } from "@kazusa/client";

export const TAIL_LIMIT = 500;

/** Merge the recent live window. Journal sequences are ordered, not contiguous. */
export function mergeTail(
  tail: readonly JournalEvent[],
  events: readonly JournalEvent[],
  limit = TAIL_LIMIT,
): readonly JournalEvent[] {
  const unique = new Map(tail.map((event) => [event.seq, event]));
  for (const event of events) {
    if (!unique.has(event.seq)) unique.set(event.seq, event);
  }
  if (unique.size === tail.length) return tail;
  return [...unique.values()].sort((a, b) => a.seq - b.seq).slice(-limit);
}

/**
 * Merges tail (ascending) and history pages (newest-first) into newest-first,
 * unique by seq.
 */
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
