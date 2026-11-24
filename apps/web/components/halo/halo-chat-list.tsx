"use client";

import type { CharacterSummary } from "@kazusa/client";
import { SquarePenIcon, XIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { NewChatDialog } from "@/components/views/chats/new-chat-dialog";
import { chatsParsers } from "@/components/views/chats/search-params";
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
import { HaloFace } from "./halo-face";

export function HaloChatList({ onNavigated }: { onNavigated?: () => void }) {
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

  return (
    <div className="halo-side">
      <div className="halo-side-head">
        <input
          type="search"
          className="halo-input"
          aria-label="Search chats"
          placeholder={total ? `Search ${total} chats` : "Search chats"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="halo-icon-button"
          aria-label="New chat"
          title={canAct ? "New chat" : "Play as someone to start a chat"}
          disabled={!canAct}
          onClick={() => setNewChatOpen(true)}
        >
          <SquarePenIcon aria-hidden className="size-4" />
        </button>
      </div>

      {member ? (
        <div className="halo-filter-chip">
          <span>{`${byId.get(member)?.name ?? member}'s chats`}</span>
          <button
            type="button"
            aria-label="Show everyone's chats"
            onClick={() => void setParams({ "chats.member": null })}
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div className="halo-side-scroll">
        {error ? (
          <div className="halo-empty">
            <p>{"Can't reach the Kazusa server, so your chats aren't loaded."}</p>
            <button
              type="button"
              className="halo-text-button"
              onClick={() => void reload()}
            >
              Retry
            </button>
          </div>
        ) : null}

        {player.id ? (
          <ChatGroup
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
                  ? `No chats match “${query}”.`
                  : "No conversations yet. Start one with the pen above."
            }
          />
        ) : null}

        {observed.available ? (
          <ChatGroup
            title={player.id ? "Overheard" : "Conversations"}
            note="Read-only. Nobody in them can tell."
            chats={others}
            byId={byId}
            unread={unread}
            selected={params["chats.id"]}
            onOpen={openById}
            empty={
              q
                ? `No chats match “${query}”.`
                : "Nobody is talking yet. They show up here as people start texting."
            }
          />
        ) : null}
      </div>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onDirect={(id) =>
          void setParams({ view: "chats", "chats.id": null, "chats.member": id })
        }
        // A new group is a draft until its first message, so it isn't in the
        // lists yet; the conversation reads it from the draft store.
        onGroup={(chat) => {
          setDraftChat(chat);
          open(chat);
        }}
      />
    </div>
  );
}

function ChatGroup({
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
    <section className="halo-group" aria-label={title}>
      <h2 className="halo-group-title">
        {title}
        {note ? <span className="halo-group-note">{note}</span> : null}
      </h2>
      {chats.length === 0 ? (
        <p className="halo-group-empty">{empty}</p>
      ) : (
        <ul className="halo-rows">
          {chats.map((chat) => {
            const faces = chat.members
              .map((id) => byId.get(id))
              .filter((c): c is CharacterSummary => Boolean(c))
              .slice(0, 2);
            const count = unread[chat.id] ?? 0;
            return (
              <li key={chat.id}>
                <button
                  type="button"
                  className="halo-row"
                  aria-current={selected === chat.id ? "true" : undefined}
                  onClick={() => onOpen(chat.id)}
                >
                  <span className="halo-row-faces" data-count={faces.length}>
                    {faces.map((c) => (
                      <HaloFace
                        key={c.id}
                        id={c.id}
                        name={c.name}
                        avatarUrl={c.avatarUrl}
                        kind={c.kind}
                      />
                    ))}
                  </span>
                  <span className="halo-row-text">
                    <span className="halo-row-name">{chat.name}</span>
                    <span className="halo-row-sub">
                      {chat.lastMessage?.text ?? "No messages yet"}
                    </span>
                  </span>
                  {count > 0 ? (
                    <span className="halo-badge">
                      {count > 99 ? "99+" : count}
                      <span className="sr-only"> unread</span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
