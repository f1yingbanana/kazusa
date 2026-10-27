import type {
  JournalEvent,
  TimelineQuery,
  TimelineResponse,
} from "@kazusa/client";

export const TIMELINE_PAGE_SIZE = 100;

export function matchesTimelineQuery(event: JournalEvent, query: TimelineQuery) {
  if (query.kinds?.length && !query.kinds.includes(event.kind)) return false;
  if (query.actors?.length && !event.actors.some((a) => query.actors!.includes(a)))
    return false;
  if (query.chats?.length && (!event.chatId || !query.chats.includes(event.chatId)))
    return false;
  return true;
}

/**
 * Same semantics the plugin route must implement: server-side filters,
 * `before` pages newest-first, `after` returns ascending for catch-up, and
 * cursors are journal `seq` values.
 */
export function queryJournal(
  journal: readonly JournalEvent[],
  query: TimelineQuery,
): TimelineResponse {
  const limit = query.limit ?? TIMELINE_PAGE_SIZE;
  if (query.after !== undefined) {
    const events: JournalEvent[] = [];
    for (const event of journal) {
      if (event.seq <= query.after || !matchesTimelineQuery(event, query)) continue;
      events.push(event);
      if (events.length > limit) break;
    }
    const hasMore = events.length > limit;
    return { events: events.slice(0, limit), hasMore };
  }

  const events: JournalEvent[] = [];
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const event = journal[index];
    if (query.before !== undefined && event.seq >= query.before) continue;
    if (!matchesTimelineQuery(event, query)) continue;
    events.push(event);
    if (events.length > limit) break;
  }
  const hasMore = events.length > limit;
  const page = events.slice(0, limit);
  return {
    events: page,
    hasMore,
    nextCursor: hasMore ? page[page.length - 1]?.seq : undefined,
  };
}
