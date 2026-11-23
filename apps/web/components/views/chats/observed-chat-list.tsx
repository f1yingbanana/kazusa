"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRightIcon,
  EyeIcon,
  HistoryIcon,
  MessageCircleIcon,
  SpeechIcon,
  type LucideIcon,
} from "lucide-react";
import { useSimNow } from "@/hooks/use-clock";
import type { Agent } from "@kazusa/client";
import { chatSections, type ChatSectionId } from "@/lib/source/chats/sections";
import type { ChatInfo } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import { ChatRow } from "./chat-list";

const ROW_ESTIMATE = 56;
const HEADING_ESTIMATE = 28;

const SECTION_ICONS: Readonly<Record<ChatSectionId, LucideIcon>> = {
  "in-person": SpeechIcon,
  messages: MessageCircleIcon,
  earlier: HistoryIcon,
};

type Row =
  | {
      readonly kind: "heading";
      readonly id: ChatSectionId;
      readonly label: string;
      readonly count: number;
    }
  | { readonly kind: "chat"; readonly chat: ChatInfo };

/**
 * The chats the viewer isn't in: people talking in person, then text chats,
 * then talks that are over, each under its own heading. Below the player's own
 * chats it folds away under "Other chats"; for someone only watching it is the
 * whole list (`standalone`). One scroll, virtualized against the sidebar's
 * scroller, since a busy world has thousands.
 */
export function ObservedChatList({
  chats,
  total,
  agentsById,
  userId,
  selectedChatId,
  open,
  standalone = false,
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
  /** Nothing of the viewer's own is above it: no fold, no "Other". */
  standalone?: boolean;
  onToggle: () => void;
  onSelect: (chatId: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const simNow = useSimNow();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const shown = standalone || open;
  const rows = useMemo<Row[]>(
    () =>
      chatSections(chats).flatMap((section) => [
        {
          kind: "heading" as const,
          id: section.id,
          label: section.label,
          count: section.chats.length,
        },
        ...section.chats.map((chat) => ({ kind: "chat" as const, chat })),
      ]),
    [chats],
  );

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
    count: shown ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "heading" ? HEADING_ESTIMATE : ROW_ESTIMATE,
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === "heading" ? `heading:${row.id}` : row.chat.id;
    },
    overscan: 8,
    scrollMargin,
  });
  const nameOf = (id: string) => agentsById.get(id)?.name ?? id;

  return (
    <section className="flex flex-col gap-0.5 px-2 pb-2">
      {standalone ? null : (
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
      )}
      <div
        ref={listRef}
        className="relative w-full"
        style={{ height: shown ? virtualizer.getTotalSize() : 0 }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
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
              {row.kind === "heading" ? (
                <SectionHeading
                  icon={SECTION_ICONS[row.id]}
                  label={row.label}
                  count={row.count}
                  // The first heading sits right under the search box.
                  first={item.index === 0}
                />
              ) : (
                <ChatRow
                  chat={row.chat}
                  agentsById={agentsById}
                  userId={userId}
                  nameOf={nameOf}
                  isActive={row.chat.id === selectedChatId}
                  observed
                  simNow={simNow}
                  onSelect={onSelect}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectionHeading({
  icon: Icon,
  label,
  count,
  first,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  first: boolean;
}) {
  return (
    <h4
      className={cn(
        "flex min-w-0 items-center gap-1.5 px-2 pb-0.5 text-xs font-medium text-muted-foreground",
        !first && "mt-1 border-t border-border/60 pt-2",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <span className="ml-auto font-mono text-[11px] tabular-nums">
        {count}
      </span>
    </h4>
  );
}
