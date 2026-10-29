"use client";

import {
  MessageCircleIcon,
  MessagesSquareIcon,
  SpeechIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
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
import { usePlace } from "@/hooks/use-location";
import { formatListTimestamp } from "@/lib/format";
import type { Agent } from "@kazusa/client";
import { messagePreview } from "@/lib/source/chats/display";
import type { Chat } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./chat-avatar";
import { useRealtime, type Typist } from "@/lib/live/realtime-provider";

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

  // Face-to-face first: you can only be in huddles where you stand.
  const huddles = filtered.filter((chat) => chat.type === "huddle");
  const byPlace = new Map<string, Chat[]>();
  for (const chat of huddles) {
    const key = chat.placeId ?? "";
    byPlace.set(key, [...(byPlace.get(key) ?? []), chat]);
  }
  const texts = filtered.filter((chat) => chat.type !== "huddle");
  const nameOf = (id: string) => agentsById.get(id)?.name ?? id;
  const row = (chat: Chat) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      agentsById={agentsById}
      userId={userId}
      nameOf={nameOf}
      isActive={chat.id === selectedChatId}
      typists={typingByChat[chat.id] ?? []}
      unread={unreadByChat[chat.id] ?? 0}
      simNow={simNow}
      onSelect={onSelect}
    />
  );

  if (huddles.length === 0) {
    return (
      <ItemGroup className="gap-0.5 px-2 pb-2">{texts.map(row)}</ItemGroup>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {[...byPlace].map(([placeId, atPlace]) => (
        <ListSection
          key={`place:${placeId}`}
          icon={SpeechIcon}
          label={
            placeId ? (
              <>
                In person at <PlaceName id={placeId} />
              </>
            ) : (
              "In person"
            )
          }
        >
          {atPlace.map(row)}
        </ListSection>
      ))}
      {texts.length ? (
        <ListSection icon={MessageCircleIcon} label="Messages">
          {texts.map(row)}
        </ListSection>
      ) : null}
    </div>
  );
}

function PlaceName({ id }: { id: string }) {
  return <>{usePlace(id)?.name ?? id}</>;
}

function ListSection({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5 px-2">
      <h3 className="flex min-w-0 items-center gap-1.5 px-2 pb-0.5 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </h3>
      <ItemGroup className="gap-0.5">{children}</ItemGroup>
    </section>
  );
}

function ChatRow({
  chat,
  agentsById,
  userId,
  nameOf,
  isActive,
  typists,
  unread,
  simNow,
  onSelect,
}: {
  chat: Chat;
  agentsById: ReadonlyMap<string, Agent>;
  userId: string;
  nameOf: (id: string) => string;
  isActive: boolean;
  typists: readonly Typist[];
  unread: number;
  simNow: number;
  onSelect: (chatId: string) => void;
}) {
  const preview =
    typists.length > 0
      ? `${typists[0].senderName} is ${chat.type === "huddle" ? "about to speak" : "typing"}…`
      : chat.lastMessage
        ? messagePreview(chat.lastMessage, chat, userId, nameOf)
        : "No messages yet";

  return (
    <Item
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
          {chat.type === "direct" &&
          chat.members.some((id) => agentsById.get(id)?.isSystemAgent) ? (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              ADMIN
            </Badge>
          ) : null}
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
            chat.lastMessage?.type === "action" && "italic",
            typists.length > 0 && "shimmer text-primary not-italic",
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
