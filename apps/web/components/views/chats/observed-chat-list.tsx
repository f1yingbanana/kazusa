"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon, EyeIcon } from "lucide-react";
import { useSimNow } from "@/hooks/use-clock";
import { useRealtime } from "@/lib/live/realtime-provider";
import type { Agent } from "@kazusa/client";
import type { ChatInfo } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import { ChatRow } from "./chat-list";

const ROW_ESTIMATE = 56;

/**
 * Other chats, below the player's own: same rows, one scroll, folded away when
 * unwanted. Virtualized against the sidebar's scroller, since a busy world has
 * thousands.
 */
export function ObservedChatList({
  chats,
  total,
  agentsById,
  userId,
  selectedChatId,
  open,
  onToggle,
  onSelect,
  scrollRef,
}: {
  chats: readonly ChatInfo[];
  total: number;
  agentsById: ReadonlyMap<string, Agent>;
  userId: string;
  selectedChatId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (chatId: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { typingByChat } = useRealtime();
  const simNow = useSimNow();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The player's own chats sit above and change height as they come and go.
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    const margin =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((current) => (current === margin ? current : margin));
  });

  const virtualizer = useVirtualizer({
    count: open ? chats.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (index) => chats[index]?.id ?? index,
    overscan: 8,
    scrollMargin,
  });
  const nameOf = (id: string) => agentsById.get(id)?.name ?? id;

  return (
    <section className="flex flex-col gap-0.5 px-2 pb-2">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/70 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          <EyeIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">Other chats</span>
          <span className="ml-auto font-mono text-[11px] tabular-nums">
            {total}
          </span>
        </button>
      </h3>
      <div
        ref={listRef}
        className="relative w-full"
        style={{ height: open ? virtualizer.getTotalSize() : 0 }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const chat = chats[item.index];
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute top-0 left-0 w-full pb-0.5"
              style={{
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <ChatRow
                chat={chat}
                agentsById={agentsById}
                userId={userId}
                nameOf={nameOf}
                isActive={chat.id === selectedChatId}
                typists={typingByChat[chat.id] ?? []}
                unread={0}
                simNow={simNow}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
