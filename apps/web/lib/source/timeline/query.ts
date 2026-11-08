import type { JournalEvent, TimelineQuery } from "@kazusa/client";

export const TIMELINE_PAGE_SIZE = 100;

/** Same filters as the plugin route, for the live tail it hasn't filtered. */
export function matchesTimelineQuery(
  event: JournalEvent,
  query: TimelineQuery,
) {
  if (query.kinds?.length && !query.kinds.includes(event.kind)) return false;
  const actors = query.actors;
  if (actors?.length && !event.actors.some((actor) => actors.includes(actor)))
    return false;
  if (
    query.chats?.length &&
    (!event.chatId || !query.chats.includes(event.chatId))
  )
    return false;
  return true;
}
