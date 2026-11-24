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
import { useObservedChat, useObservedChats } from "@/hooks/use-observed-chats";
import { usePlaces, usePlayer } from "@/hooks/use-location";
import { useAccess } from "@/hooks/use-access";
import { useMediaQuery } from "@/hooks/use-media-query";
import { setActiveChat, useRealtimeStore } from "@/lib/live/realtime-state";
import { chatSubject } from "@/lib/source/chats/display";
import { liveliestChat } from "@/lib/source/chats/sections";
import { useSelfIn } from "@/hooks/use-self";
import { setDraftChat, useDraftChat } from "@/lib/state/chat-draft";
import { keepsLinkedSelection, markQuietSelection } from "@/lib/state/ui-store";
import { useSources } from "@/lib/source/provider";
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
  const docked = useMediaQuery("(min-width: 1024px)");
  const { player, operator, watching } = useSources();
  const selfOf = useSelfIn();
  // Who is played now, read when a send comes back.
  const playing = useRef(player.id);
  useEffect(() => {
    playing.current = player.id;
  }, [player.id]);
  const { canPlay, isLoading: isAccessLoading } = useAccess();
  const { chats } = useChats();
  const { byId } = useCharacters();
  const { createChat } = useChatActions();
  const [queryState, setParams] = useQueryStates({
    "chats.id": chatsParsers["chats.id"],
    "chats.dm": chatsParsers["chats.dm"],
    "chats.talk": chatsParsers["chats.talk"],
    "chats.member": chatsParsers["chats.member"],
    sel: entityRefParser,
  });
  const chatId = queryState["chats.id"];
  const dmTarget = queryState["chats.dm"];
  const talkTarget = queryState["chats.talk"];
  const position = usePlayer();
  const places = usePlaces();
  const draft = useDraftChat();

  const selected =
    chats.find((chat) => chat.id === chatId) ??
    (draft?.id === chatId ? draft : null);
  const observed = useObservedChat(selected ? null : chatId).chat;
  const open = selected ?? observed;

  useEffect(() => {
    setActiveChat(open?.id ?? null);
    return () => setActiveChat(null);
  }, [open?.id]);

  // Opening a chat, or coming back to Chats with one open, points the inspector
  // at it (the partner of a DM), whatever was selected before; picking
  // something else afterwards sticks. A page loaded from a link that names a
  // selection too keeps it.
  const subject = open ? chatSubject(open, selfOf(open)) : null;
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
    // You and them: the one you play, or you yourself while playing nobody.
    // To the system agent it is always you: your console, since nobody in the
    // world talks with her.
    const self = byId.get(dmTarget)?.isSystemAgent
      ? operator.id
      : player.id || operator.id;
    const existing = chats.find(
      (chat) =>
        chat.type === "direct" &&
        chat.members.length === 2 &&
        chat.members.includes(dmTarget) &&
        chat.members.includes(self),
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
    const next = createChat(
      {
        type: "direct",
        name: byId.get(dmTarget)?.name ?? dmTarget,
        members: [dmTarget],
      },
      self,
    );
    setDraftChat(next);
    void setParams(
      { "chats.id": next.id, "chats.dm": null },
      { history: "replace" },
    );
  }, [
    dmTarget,
    chats,
    player.id,
    operator.id,
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
        chat.placeId === position.placeId &&
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
        (position.placeId && places?.byId.get(position.placeId)?.name) ??
        "In person",
      members: [talkTarget],
      ...(position.placeId ? { placeId: position.placeId } : {}),
    });
    setDraftChat(next);
    void setParams(
      { "chats.id": next.id, "chats.talk": null },
      { history: "replace" },
    );
  }, [
    talkTarget,
    chats,
    position.placeId,
    places,
    createChat,
    setParams,
    canPlay,
    isAccessLoading,
  ]);

  // Arriving to watch with nothing picked: open where something is happening,
  // once, so the stage isn't an empty "pick a conversation". On a narrow screen
  // the list is the first screen, and in a quiet world it waits for the first
  // conversation. A link narrowed to one character opens one of theirs.
  const everyone = useObservedChats();
  const member = queryState["chats.member"];
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    if (chatId || dmTarget || talkTarget) {
      arrived.current = true;
      return;
    }
    if (!watching || !docked) return;
    const { typingByChat } = useRealtimeStore.getState();
    const composingIn = new Set(
      Object.keys(typingByChat).filter(
        (id) => (typingByChat[id]?.length ?? 0) > 0,
      ),
    );
    const pick = liveliestChat(
      member
        ? everyone.chats.filter((chat) => chat.members.includes(member))
        : everyone.chats,
      composingIn,
    );
    if (!pick) return;
    arrived.current = true;
    void setParams({ "chats.id": pick.id }, { history: "replace" });
  }, [
    chatId,
    dmTarget,
    talkTarget,
    watching,
    docked,
    everyone.chats,
    member,
    setParams,
  ]);

  if (selected) {
    // Who sends here is part of the view: switching starts it afresh, so a
    // failed line kept for retry never goes out as the next character.
    const sentAs = player.id;
    return (
      <div className="flex min-h-0 flex-1">
        <ChatView
          key={`${selected.id}:${selfOf(selected)}`}
          chat={selected}
          onBack={() => void setParams({ "chats.id": null })}
          onSent={(chat) => {
            // A first send that lands after a switch doesn't bring it back.
            if (playing.current !== sentAs) return;
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

  if (!docked) return <ChatsPanel />;

  return (
    <Empty className="border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquareIcon />
        </EmptyMedia>
        <EmptyTitle>Pick a conversation</EmptyTitle>
        <EmptyDescription>
          Choose one from the list, or open a character and choose Message.
          Chats you aren&apos;t in open read-only, and nobody in them can tell.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
