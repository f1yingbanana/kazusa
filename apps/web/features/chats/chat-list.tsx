"use client";

import type { CharacterSummary } from "@kazusa/client";
import { SquarePenIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useChats } from "@/hooks/use-chats";
import { useObservedChats } from "@/hooks/use-observed-chats";
import { usePlay } from "@/hooks/use-play";
import { useSelfIn } from "@/hooks/use-self";
import { useRealtimeStore } from "@/lib/live/realtime-state";
import { openChatPatch } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { setDraftChat } from "@/lib/state/chat-draft";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
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
  ListSection,
} from "@/ui/list";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { chatsParsers, NewChatDialog } from "../legacy";

export function ChatList({ onNavigated }: { onNavigated?: () => void }) {
  const { player } = useSources();
  const selfOf = useSelfIn();
  const { canAct } = usePlay();
  const { chats: mine, isLoading, error, reload } = useChats();
  const observed = useObservedChats();
  const { byId } = useCharacters();
  const unread = useRealtimeStore((state) => state.unreadByChat);
  const [params, setParams] = useQueryStates({
    "chats.id": chatsParsers["chats.id"],
    "chats.member": chatsParsers["chats.member"],
    "chats.dm": chatsParsers["chats.dm"],
    view: parseAsString,
    sel: entityRefParser,
  });
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const member = params["chats.member"];
  const q = query.trim().toLowerCase();

  const filter = useMemo(
    () => (list: readonly ChatInfo[]) =>
      list.filter(
        (chat) =>
          (!member || chat.members.includes(member)) &&
          (!q ||
            chat.name.toLowerCase().includes(q) ||
            chat.lastMessage?.text.toLowerCase().includes(q)),
      ),
    [member, q],
  );
  const yours = filter(mine);
  const mineIds = new Set(mine.map((c) => c.id));
  const others = filter(observed.chats.filter((c) => !mineIds.has(c.id)));

  function open(chat: ChatInfo) {
    const patch = openChatPatch(chat, selfOf(chat));
    if (patch.sel) markQuietSelection(serializeEntityRef(patch.sel));
    void setParams(patch);
    onNavigated?.();
  }

  function openById(id: string) {
    const chat =
      mine.find((c) => c.id === id) ?? observed.chats.find((c) => c.id === id);
    if (chat) open(chat);
    else void setParams({ view: "chats", "chats.id": id });
  }

  const total = mine.length + observed.chats.length;
  const noMatch = `No chats match “${query}”.`;

  return (
    <ListPane
      head={
        <>
          <SearchInput
            aria-label="Search chats"
            placeholder={total ? `Search ${total} chats` : "Search chats"}
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
      {member ? (
        <FilterChip
          clearLabel="Show everyone's chats"
          onClear={() => void setParams({ "chats.member": null })}
        >
          {`${byId.get(member)?.name ?? member}'s chats`}
        </FilterChip>
      ) : null}

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

        {player.id ? (
          <ChatSection
            title="Yours"
            chats={yours}
            byId={byId}
            unread={unread}
            selected={params["chats.id"]}
            onOpen={openById}
            empty={
              isLoading
                ? "Loading chats…"
                : q
                  ? noMatch
                  : "No conversations yet. Start one with the pen above."
            }
          />
        ) : null}

        {observed.available ? (
          <ChatSection
            title={player.id ? "Overheard" : "Conversations"}
            note="Read-only. Nobody in them can tell."
            chats={others}
            byId={byId}
            unread={unread}
            selected={params["chats.id"]}
            onOpen={openById}
            empty={
              q
                ? noMatch
                : "Nobody is talking yet. They show up here as people start texting."
            }
          />
        ) : null}
      </ListPaneScroll>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        // The conversation opens their direct chat, or starts one.
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
        onOpenGroup={(id) => void setParams({ view: "chats", "chats.id": id })}
      />
    </ListPane>
  );
}

function ChatSection({
  title,
  note,
  chats,
  byId,
  unread,
  selected,
  onOpen,
  empty,
}: {
  title: string;
  note?: string;
  chats: readonly ChatInfo[];
  byId: ReadonlyMap<string, CharacterSummary>;
  unread: Readonly<Record<string, number>>;
  selected: string | null;
  onOpen: (id: string) => void;
  empty: string;
}) {
  return (
    <ListSection title={title} note={note}>
      {chats.length === 0 ? (
        <Note inset="list">{empty}</Note>
      ) : (
        <ListRows>
          {chats.map((chat) => {
            const faces = chat.members
              .map((id) => byId.get(id))
              .filter((c): c is CharacterSummary => Boolean(c))
              .slice(0, 2);
            const count = unread[chat.id] ?? 0;
            return (
              <li key={chat.id}>
                <ListRow
                  current={selected === chat.id}
                  onClick={() => onOpen(chat.id)}
                  leading={
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
                  }
                  title={chat.name}
                  sub={chat.lastMessage?.text ?? "No messages yet"}
                  trailing={
                    count > 0 ? <Badge count={count} label="unread" /> : null
                  }
                />
              </li>
            );
          })}
        </ListRows>
      )}
    </ListSection>
  );
}
