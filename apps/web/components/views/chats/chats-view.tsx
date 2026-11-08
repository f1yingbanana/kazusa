"use client";

import { useQueryStates } from "nuqs";
import { chatsParsers } from "./search-params";
import { entityRefParser, serializeEntityRef } from "@/lib/state/entity-ref";
import { useEffect, useRef } from "react";
import { MessagesSquareIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCharacters } from "@/hooks/use-characters";
import { useChatActions, useChats } from "@/hooks/use-chats";
import { useObservedChat } from "@/hooks/use-observed-chats";
import { usePlaces, usePlayer } from "@/hooks/use-location";
import { useAccess } from "@/hooks/use-access";
import { useRealtime } from "@/lib/live/realtime-provider";
import { chatSubject } from "@/lib/source/chats/display";
import { setDraftChat, useDraftChat } from "@/lib/state/chat-draft";
import {
  keepsLinkedSelection,
  markQuietSelection,
} from "@/lib/state/inspector-request";
import { useKazusaConfig } from "@/lib/state/config-store";
import { ChatView } from "./chat-view";
import { ChatsPanel } from "./chats-panel";
import { ObservedChatView } from "./observed-chat-view";

/**
 * The open conversation. The chat list is this section's sidebar; on narrow
 * screens (no docked sidebar) it is this screen until a chat is opened.
 *
 * Params: `chats.id` (open chat), `chats.dm` (start/open a direct chat with a
 * character, then replaced by `chats.id`), `chats.talk` (talk in person with a
 * character where you both stand, likewise replaced), `chats.member` (narrow
 * the list to one character's chats). A chat the player isn't in opens
 * read-only. `chats.msg` deep-link highlighting is on the roadmap.
 */
export function ChatsView() {
  const config = useKazusaConfig();
  const { canPlay, isLoading: isAccessLoading } = useAccess();
  const { chats } = useChats();
  const { byId } = useCharacters();
  const { createChat } = useChatActions();
  const { setActiveChat } = useRealtime();
  const [queryState, setParams] = useQueryStates({
    "chats.id": chatsParsers["chats.id"],
    "chats.dm": chatsParsers["chats.dm"],
    "chats.talk": chatsParsers["chats.talk"],
    sel: entityRefParser,
  });
  const chatId = queryState["chats.id"];
  const dmTarget = queryState["chats.dm"];
  const talkTarget = queryState["chats.talk"];
  const player = usePlayer();
  const places = usePlaces();
  const draft = useDraftChat();

  const selected =
    chats.find((chat) => chat.id === chatId) ??
    (draft?.id === chatId ? draft : null);
  const observed = useObservedChat(selected ? null : chatId).chat;
  const open = selected ?? observed;

  useEffect(() => {
    setActiveChat(open?.id ?? null);
  }, [open?.id, setActiveChat]);

  // Opening a chat, or coming back to Chats with one open, points the inspector
  // at it (the partner of a DM), whatever was selected before; picking
  // something else afterwards sticks. A page loaded from a link that names a
  // selection too keeps it.
  const subject = open ? chatSubject(open, config.userId) : null;
  const subjectKey = subject ? serializeEntityRef(subject) : null;
  const selParam = queryState["sel"];
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!subjectKey || followed.current === subjectKey) return;
    followed.current = subjectKey;
    // Most ways in (the chat list, ⌘K) already selected it with the chat.
    if (selParam && serializeEntityRef(selParam) === subjectKey) return;
    if (keepsLinkedSelection("chats.id")) return;
    markQuietSelection(subjectKey);
    void setParams({ sel: subject }, { history: "replace" });
    // `selParam` is read, not followed: picking someone else afterwards sticks.
  }, [subjectKey, setParams]);

  useEffect(() => {
    if (draft && !draft.draft && chats.some((chat) => chat.id === draft.id))
      setDraftChat(null);
  }, [chats, draft]);

  const handledDm = useRef<string | null>(null);
  useEffect(() => {
    if (!dmTarget) {
      handledDm.current = null;
      return;
    }
    if (isAccessLoading) return;
    if (handledDm.current === dmTarget) return;
    handledDm.current = dmTarget;
    const existing = chats.find(
      (chat) =>
        chat.type === "direct" &&
        chat.members.includes(dmTarget) &&
        chat.members.every(
          (member) => member === dmTarget || member === config.userId,
        ),
    );
    if (existing) {
      void setParams(
        { "chats.id": existing.id, "chats.dm": null },
        { history: "replace" },
      );
      return;
    }
    if (!canPlay) {
      void setParams({ "chats.dm": null }, { history: "replace" });
      return;
    }
    const next = createChat({
      type: "direct",
      name: byId.get(dmTarget)?.name ?? dmTarget,
      members: [dmTarget],
    });
    setDraftChat(next);
    void setParams(
      { "chats.id": next.id, "chats.dm": null },
      { history: "replace" },
    );
  }, [
    dmTarget,
    chats,
    config.userId,
    byId,
    createChat,
    setParams,
    canPlay,
    isAccessLoading,
  ]);

  // Talking in person: the huddle you are already in with them, or a new one
  // where you stand. Its first message is said aloud, which brings them (and
  // whoever they are talking with) into it, or you into theirs.
  const handledTalk = useRef<string | null>(null);
  useEffect(() => {
    if (!talkTarget) {
      handledTalk.current = null;
      return;
    }
    if (isAccessLoading) return;
    if (handledTalk.current === talkTarget) return;
    handledTalk.current = talkTarget;
    const existing = chats.find(
      (chat) =>
        chat.type === "huddle" &&
        chat.placeId === player.placeId &&
        chat.members.includes(talkTarget),
    );
    if (existing) {
      void setParams(
        { "chats.id": existing.id, "chats.talk": null },
        { history: "replace" },
      );
      return;
    }
    if (!canPlay) {
      void setParams({ "chats.talk": null }, { history: "replace" });
      return;
    }
    const next = createChat({
      type: "huddle",
      name:
        (player.placeId && places?.byId.get(player.placeId)?.name) ??
        "In person",
      members: [talkTarget],
      ...(player.placeId ? { placeId: player.placeId } : {}),
    });
    setDraftChat(next);
    void setParams(
      { "chats.id": next.id, "chats.talk": null },
      { history: "replace" },
    );
  }, [
    talkTarget,
    chats,
    player.placeId,
    places,
    createChat,
    setParams,
    canPlay,
    isAccessLoading,
  ]);

  if (selected) {
    return (
      <div className="flex min-h-0 flex-1">
        <ChatView
          key={selected.id}
          chat={selected}
          onBack={() => void setParams({ "chats.id": null })}
          onSent={(chat) => {
            setDraftChat(chat);
            void setParams({ "chats.id": chat.id });
          }}
        />
      </div>
    );
  }

  if (observed) {
    return (
      <div className="flex min-h-0 flex-1">
        <ObservedChatView
          key={observed.id}
          chat={observed}
          onBack={() => void setParams({ "chats.id": null })}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <ChatsPanel />
      </div>
      <Empty className="hidden border-none lg:flex">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Pick a conversation</EmptyTitle>
          <EmptyDescription>
            Choose one from the list, or open a character and choose Message.
            Chats you aren&apos;t in open read-only, and nobody in them can
            tell.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
