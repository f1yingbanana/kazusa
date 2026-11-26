"use client";

import type { CharacterSummary } from "@kazusa/client";
import { EyeIcon, SquarePenIcon } from "lucide-react";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useChats } from "@/hooks/use-chats";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { usePlay } from "@/hooks/use-play";
import { useSelfIn } from "@/hooks/use-self";
import { formatListTimestamp } from "@/lib/format";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { messagePreview } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { setDraftChat } from "@/lib/state/chat-draft";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { matchesQuery } from "@/lib/state/grouping";
import { useWatchlist } from "@/lib/state/preferences-store";
import { markQuietSelection } from "@/lib/state/ui-store";
import { AvatarStack } from "@/ui/avatar";
import { Button, IconButton } from "@/ui/button";
import { SearchInput } from "@/ui/input";
import {
  Badge,
  FilterChip,
  ListPane,
  ListPaneScroll,
  ListRow,
  ListRows,
} from "@/ui/list";
import { EmptySeats } from "@/ui/empty-seats";
import { Note } from "@/ui/note";
import { NO_FAVORITES } from "../characters/favorites";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { chatIcon } from "../entities/chat-meta";
import { CharacterAvatar } from "../characters/character-avatar";
import { chatsParsers } from "./search-params";
import { NewChat } from "./new-chat";
import { conversationParsers, conversationPatch } from "./open";

const SHOWS = ["yours", "all", "favorites"] as const;
type Show = (typeof SHOWS)[number];

const LABEL: Record<Show, string> = {
  yours: "Yours",
  all: "Everyone",
  favorites: "Favorites",
};

interface Row {
  readonly chat: ChatInfo;
  readonly mine: boolean;
}

/**
 * Texts, newest first, as a phone lists them. Someone playing sees theirs, and
 * can widen it to everyone's; someone watching sees everyone's; either can
 * narrow it to chats with their favorites in them. Search finds chats by name,
 * by what was said, or by someone in them; a character's "Their chats" narrows
 * it to theirs. Others' read along, and nobody in them can tell: their rows
 * carry an eye.
 */
export function ChatList({ onNavigated }: { onNavigated?: () => void }) {
  const { player } = useSources();
  const selfOf = useSelfIn();
  const { canAct } = usePlay();
  const { chats: mine, isLoading, error, reload } = useChats();
  const observed = useObservedChats();
  const { byId } = useCharacters();
  const now = useSimNow();
  const unread = useRealtimeStore((state) => state.unreadByChat);
  const [params, setParams] = useQueryStates({
    ...conversationParsers,
    "chats.member": chatsParsers["chats.member"],
    "chats.dm": chatsParsers["chats.dm"],
    "chats.show": parseAsStringLiteral(SHOWS),
  });
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const member = params["chats.member"];
  const playing = Boolean(player.id);
  // Yours while playing, everyone's where there's more to read, and always
  // your favorites': what isn't offered falls back to the first that is.
  const offered: Show[] = [
    ...(playing ? (["yours"] as const) : []),
    ...(observed.available || !playing ? (["all"] as const) : []),
    "favorites",
  ];
  const asked = params["chats.show"];
  const show: Show = asked && offered.includes(asked) ? asked : offered[0];
  const favorite = new Set(useWatchlist());
  const q = query.trim().toLowerCase();

  const all = useMemo((): Row[] => {
    const mineIds = new Set(mine.map((c) => c.id));
    return [
      ...mine.map((chat): Row => ({ chat, mine: true })),
      ...observed.chats
        .filter((chat) => !mineIds.has(chat.id))
        .map((chat): Row => ({ chat, mine: false })),
    ].filter((row) => row.chat.type !== "huddle");
  }, [mine, observed.chats]);

  const rows = all
    .filter(
      (row) =>
        (member
          ? row.chat.members.includes(member)
          : show === "favorites"
            ? row.chat.members.some((m) => favorite.has(m))
            : show === "all" || row.mine) &&
        (!q ||
          row.chat.name.toLowerCase().includes(q) ||
          row.chat.lastMessage?.text.toLowerCase().includes(q) ||
          row.chat.members.some((m) => {
            const c = byId.get(m);
            return c ? matchesQuery(c, q) : false;
          })),
    )
    .sort(
      (a, b) =>
        (b.chat.lastMessage?.timestamp ?? 0) -
        (a.chat.lastMessage?.timestamp ?? 0),
    );

  function open(chat: ChatInfo) {
    const patch = conversationPatch(chat, selfOf(chat));
    if (patch.sel) markQuietSelection(serializeEntityRef(patch.sel));
    void setParams(patch);
    onNavigated?.();
  }

  const scope = member
    ? `${byId.get(member)?.name ?? member}'s`
    : show === "yours"
      ? "your"
      : show === "favorites"
        ? "your favorites'"
        : "everyone's";
  const empty = q
    ? `No chats match “${query}”.`
    : isLoading
      ? "Loading chats…"
      : member
        ? "They haven't texted anyone yet."
        : show === "yours"
          ? "No conversations yet. Start one with the pen above."
          : "No texts yet. They show up here as people start messaging.";

  return (
    <ListPane
      head={
        <>
          <SearchInput
            aria-label="Search chats"
            placeholder={`Search ${scope} chats`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <IconButton
            label="New chat"
            title={canAct ? "New chat" : "Play as someone to start a chat"}
            disabled={!canAct}
            onClick={() => setNewChatOpen(true)}
          >
            <SquarePenIcon aria-hidden />
          </IconButton>
        </>
      }
    >
      <div className="flex items-center gap-1.5 pb-3">
        {member ? (
          <FilterChip
            clearLabel="Show all chats again"
            onClear={() => void setParams({ "chats.member": null })}
          >
            {`${byId.get(member)?.name ?? member}'s chats`}
          </FilterChip>
        ) : (
          <Segmented<Show>
            aria-label="Whose chats"
            value={show}
            onValueChange={(next) =>
              next &&
              void setParams({
                "chats.show": next === offered[0] ? null : next,
              })
            }
            className="flex-1"
          >
            {offered.map((value) => (
              <SegmentedItem key={value} value={value}>
                {LABEL[value]}
              </SegmentedItem>
            ))}
          </Segmented>
        )}
      </div>

      <ListPaneScroll>
        {error ? (
          <Note
            inset="list"
            action={
              <Button tone="link" onClick={() => void reload()}>
                Retry
              </Button>
            }
          >
            {"Can't reach the Kazusa server, so your chats aren't loaded."}
          </Note>
        ) : null}
        {rows.length === 0 ? (
          show === "favorites" && !q && !member && !isLoading ? (
            favorite.size ? (
              <EmptySeats title="No chats with favorites">
                None of your favorites have texted anyone yet.
              </EmptySeats>
            ) : (
              <EmptySeats title="No favorites yet">{NO_FAVORITES}</EmptySeats>
            )
          ) : (
            <Note inset="list">{empty}</Note>
          )
        ) : (
          <ListRows>
            {rows.map(({ chat, mine: own }) => (
              <li key={chat.id}>
                <ChatRow
                  chat={chat}
                  own={own}
                  self={own ? selfOf(chat) : ""}
                  byId={byId}
                  unread={unread[chat.id] ?? 0}
                  now={now}
                  current={params["chats.id"] === chat.id}
                  onOpen={() => open(chat)}
                />
              </li>
            ))}
          </ListRows>
        )}
      </ListPaneScroll>

      <NewChat
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onDirect={(id) => {
          void setParams({ view: "chats", "chats.id": null, "chats.dm": id });
          onNavigated?.();
        }}
        // A new group is a draft until its first message, so it isn't in the
        // lists yet; the conversation reads it from the draft store.
        onGroup={(chat) => {
          setDraftChat(chat);
          open(chat);
        }}
      />
    </ListPane>
  );
}

function ChatRow({
  chat,
  own,
  self,
  byId,
  unread,
  now,
  current,
  onOpen,
}: {
  chat: ChatInfo;
  own: boolean;
  self: string;
  byId: ReadonlyMap<string, CharacterSummary>;
  unread: number;
  now: number;
  current: boolean;
  onOpen: () => void;
}) {
  const faces = chat.members
    .filter((id) => id !== self)
    .map((id) => byId.get(id))
    .filter((c): c is CharacterSummary => Boolean(c))
    .slice(0, 2);
  const last = chat.lastMessage;
  const preview = last
    ? messagePreview(last, chat, self, (id) => byId.get(id)?.name ?? "")
    : "No messages yet";
  const ChatTypeIcon = chatIcon(chat.type);
  return (
    <ListRow
      current={current}
      onClick={onOpen}
      leading={
        faces.length > 0 ? (
          <AvatarStack>
            {faces.map((c) => (
              <CharacterAvatar
                key={c.id}
                id={c.id}
                name={c.name}
                avatarUrl={c.avatarUrl}
                kind={c.kind}
              />
            ))}
          </AvatarStack>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ui-tint text-ui-soft [&_svg]:size-4.5">
            <ChatTypeIcon aria-hidden />
          </span>
        )
      }
      title={
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">{chat.name}</span>
          {last && now ? (
            <span className="shrink-0 text-xs font-semibold text-ui-soft tabular-nums">
              {formatListTimestamp(last.timestamp, now)}
            </span>
          ) : null}
        </span>
      }
      sub={
        own ? (
          preview
        ) : (
          <>
            <EyeIcon
              aria-label="Reading along"
              className="me-1 inline size-3.5 align-[-0.15em]"
            />
            {preview}
          </>
        )
      }
      trailing={unread > 0 ? <Badge count={unread} label="unread" /> : null}
    />
  );
}
