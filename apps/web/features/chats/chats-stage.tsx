"use client";

import { MessagesSquareIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useEffect, useRef } from "react";
import { useAccess } from "@/hooks/use-access";
import { useCharacters } from "@/hooks/use-characters";
import { useChatActions, useChats } from "@/hooks/use-chats";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useObservedChat, useObservedChats } from "@/hooks/use-observed-chats";
import { useSelfIn } from "@/hooks/use-self";
import { setActiveChat, useRealtimeStore } from "@/lib/live/realtime-state";
import { chatSubject } from "@/lib/source/chats/display";
import { liveliestChat } from "@/lib/source/chats/sections";
import { useSources } from "@/lib/source/provider";
import { setDraftChat, useDraftChat } from "@/lib/state/chat-draft";
import { serializeEntityRef } from "@/lib/state/entity-ref";
import { keepsLinkedSelection, markQuietSelection } from "@/lib/state/ui-store";
import { chatsParsers } from "../legacy";
import { Conversation, ObservedConversation } from "./conversation";
import { conversationParsers } from "./open";

/**
 * Texts: the open conversation, yours or one you're reading. Talking face to
 * face lives in World, so a link here to one (or `chats.talk`) moves there.
 * `chats.dm` opens your DM with someone, or starts one. Someone only watching
 * who arrives with nothing open gets the liveliest text, once.
 */
export function ChatsStage() {
  const docked = useMediaQuery("(min-width: 1024px)");
  const { player, operator, watching } = useSources();
  const selfOf = useSelfIn();
  const playing = useRef(player.id);
  useEffect(() => {
    playing.current = player.id;
  }, [player.id]);
  const { canPlay, isLoading: accessLoading } = useAccess();
  const { chats, isLoading: chatsLoading } = useChats();
  const { byId } = useCharacters();
  const { createChat } = useChatActions();
  const [params, setParams] = useQueryStates({
    ...conversationParsers,
    "chats.dm": chatsParsers["chats.dm"],
    "chats.talk": chatsParsers["chats.talk"],
    "chats.member": chatsParsers["chats.member"],
  });
  const chatId = params["chats.id"];
  // What's open now, for a send that lands after the view has moved on.
  const showing = useRef(chatId);
  useEffect(() => {
    showing.current = chatId;
  }, [chatId]);
  const dmTarget = params["chats.dm"];
  const talkTarget = params["chats.talk"];
  const draft = useDraftChat();
  const selected =
    chats.find((chat) => chat.id === chatId) ??
    (draft?.id === chatId ? draft : null);
  const observed = useObservedChat(selected ? null : chatId).chat;
  const open = selected ?? observed;
  const huddle = open?.type === "huddle" ? open.id : null;

  useEffect(() => {
    if (huddle)
      void setParams(
        { view: "world", "world.talk": huddle, "chats.id": null },
        { history: "replace" },
      );
    else if (talkTarget)
      void setParams(
        { view: "world", "world.with": talkTarget, "chats.talk": null },
        { history: "replace" },
      );
  }, [huddle, talkTarget, setParams]);

  const text = open && !huddle ? open : null;
  useEffect(() => {
    setActiveChat(text?.id ?? null);
    return () => setActiveChat(null);
  }, [text?.id]);

  // Opening a conversation points the details panel at it (the partner of a
  // DM); picking something else afterwards sticks. A link naming both keeps it.
  const subject = text ? chatSubject(text, selfOf(text)) : null;
  const subjectKey = subject ? serializeEntityRef(subject) : null;
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!subjectKey || followed.current === subjectKey) return;
    followed.current = subjectKey;
    if (params.sel && serializeEntityRef(params.sel) === subjectKey) return;
    if (keepsLinkedSelection("chats.id")) return;
    markQuietSelection(subjectKey);
    void setParams({ sel: subject }, { history: "replace" });
    // `sel` is read, not followed: picking someone else afterwards sticks.
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
    // With the chat list still loading, an existing DM looks like none: wait.
    if (accessLoading || chatsLoading || handledDm.current === dmTarget)
      return;
    handledDm.current = dmTarget;
    // You and them: the one you play, or you yourself while playing nobody (to
    // the system agent: your console).
    const self = player.id || operator.id;
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
    accessLoading,
    chatsLoading,
  ]);

  const everyone = useObservedChats();
  const member = params["chats.member"];
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
      everyone.chats.filter(
        (chat) =>
          chat.type !== "huddle" && (!member || chat.members.includes(member)),
      ),
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

  if (selected && !huddle) {
    // Who sends here is part of the view: switching starts it afresh, so a
    // failed line kept for retry never goes out as the next character.
    const sentAs = player.id;
    const sentFrom = selected.id;
    return (
      <Conversation
        key={`${selected.id}:${selfOf(selected)}`}
        chat={selected}
        onSent={(chat) => {
          // Moved on (another chat, another draft): leave that be; the list
          // picks the sent chat up on its own.
          if (playing.current !== sentAs || showing.current !== sentFrom)
            return;
          setDraftChat(chat);
          void setParams({ "chats.id": chat.id });
        }}
        onTalkInPerson={(id) =>
          void setParams({ view: "world", "world.with": id, "chats.id": null })
        }
      />
    );
  }
  if (observed && !huddle)
    return <ObservedConversation key={observed.id} chat={observed} />;

  return (
    <section
      aria-label="Chats"
      className="grid flex-1 place-content-center justify-items-center gap-3 p-8 text-center"
    >
      <span className="grid size-14 place-items-center rounded-[1.25rem] bg-ui-tint text-ui-primary motion-safe:animate-ui-bob [&_svg]:size-6">
        <MessagesSquareIcon aria-hidden />
      </span>
      <h2 className="text-lg font-extrabold">Pick a conversation</h2>
    </section>
  );
}
