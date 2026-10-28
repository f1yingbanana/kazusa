"use client";

import { MessagesSquareIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useSimNow } from "@/hooks/use-clock";
import { formatListTimestamp } from "@/lib/format";
import type { Agent } from "@kazusa/client";
import type { Chat } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./chat-avatar";
import { useRealtime } from "@/lib/live/realtime-provider";

export function ChatList({
  chats,
  agentsById,
  userId,
  isLoading,
  query,
  selectedChatId,
  onSelect,
  onNewGroup,
}: {
  chats: Chat[];
  agentsById: ReadonlyMap<string, Agent>;
  userId: string;
  isLoading: boolean;
  query: string;
  selectedChatId: string | null;
  onSelect: (chatId: string) => void;
  onNewGroup: () => void;
}) {
  const { typingByChat, unreadByChat } = useRealtime();
  const simNow = useSimNow();

  if (isLoading) return <ListSkeleton />;

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? chats.filter(
        (chat) =>
          chat.name.toLowerCase().includes(normalized) ||
          chat.lastMessage?.text.toLowerCase().includes(normalized),
      )
    : chats;

  if (chats.length === 0) {
    return (
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon />
          </EmptyMedia>
          <EmptyTitle>No conversations yet</EmptyTitle>
          <EmptyDescription>
            Message a character from the inspector, or gather a few into a
            group.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button size="sm" variant="outline" onClick={onNewGroup}>
            New group
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {"No conversations match “"}
        {query}
        {"”."}
      </p>
    );
  }

  return (
    <ItemGroup className="gap-0.5 px-2 pb-2">
      {filtered.map((chat) => {
        const typists = typingByChat[chat.id] ?? [];
        const unread = unreadByChat[chat.id] ?? 0;
        const isActive = chat.id === selectedChatId;
        const preview =
          typists.length > 0
            ? `${typists[0].senderName} is typing…`
            : (chat.lastMessage?.text ?? "No messages yet");

        return (
          <Item
            key={chat.id}
            size="sm"
            render={<button type="button" />}
            onClick={() => onSelect(chat.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "w-full cursor-pointer text-left hover:bg-sidebar-accent/70",
              isActive && "bg-sidebar-accent hover:bg-sidebar-accent",
            )}
          >
            <ItemMedia aria-hidden>
              <ChatAvatar chat={chat} agentsById={agentsById} userId={userId} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="w-full min-w-0">
                <span className="truncate">{chat.name}</span>
                {chat.type === "group" ? (
                  <UsersIcon
                    aria-label="Group"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                ) : null}
              </ItemTitle>
              <ItemDescription
                className={cn(
                  "line-clamp-1",
                  typists.length > 0 && "shimmer text-primary",
                  unread > 0 && "text-foreground",
                )}
              >
                {preview}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="flex-col items-end gap-1 self-start">
              {chat.lastMessage ? (
                <time
                  dateTime={new Date(chat.lastMessage.timestamp).toISOString()}
                  className="font-mono text-[11px] text-muted-foreground tabular-nums"
                >
                  {formatListTimestamp(chat.lastMessage.timestamp, simNow)}
                </time>
              ) : null}
              {unread > 0 ? (
                <Badge className="h-5 min-w-5 px-1.5 tabular-nums">
                  {unread > 99 ? "99+" : unread}
                  <span className="sr-only"> unread</span>
                </Badge>
              ) : null}
            </ItemActions>
          </Item>
        );
      })}
    </ItemGroup>
  );
}

export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-4 py-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 py-2">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
