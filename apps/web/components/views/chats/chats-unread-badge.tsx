"use client";

import { useRealtimeStore } from "@/lib/live/realtime-state";

export function ChatsUnreadBadge() {
  const unread = useRealtimeStore((state) =>
    Object.values(state.unreadByChat).reduce((sum, count) => sum + count, 0),
  );
  if (unread === 0) return null;
  return (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-primary-foreground tabular-nums">
      {unread > 99 ? "99+" : unread}
      <span className="sr-only"> unread</span>
    </span>
  );
}
