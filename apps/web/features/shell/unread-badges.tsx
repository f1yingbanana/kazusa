"use client";

import { useChats } from "@/hooks/use-chats";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { Badge } from "@/ui/list";

/** Unread lines in your own conversations, texts or face to face. */
function useUnread(inPerson: boolean): number {
  const { chats } = useChats();
  const unread = useRealtimeStore((state) => state.unreadByChat);
  return chats.reduce(
    (sum, chat) =>
      (chat.type === "huddle") === inPerson
        ? sum + (unread[chat.id] ?? 0)
        : sum,
    0,
  );
}

export function TextsBadge() {
  const count = useUnread(false);
  return count > 0 ? <Badge count={count} label="unread" /> : null;
}

export function TalksBadge() {
  const count = useUnread(true);
  return count > 0 ? <Badge count={count} label="unheard" /> : null;
}
