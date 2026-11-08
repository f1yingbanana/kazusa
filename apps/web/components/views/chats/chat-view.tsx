"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBrainTrace } from "@/hooks/use-brain";
import { useAccess } from "@/hooks/use-access";
import { useCharacters, useCharacterStatus } from "@/hooks/use-characters";
import { readSimNow } from "@/hooks/use-clock";
import { useChatActions, useMessages } from "@/hooks/use-chats";
import { useParticipantResolver } from "@/hooks/use-participants";
import { brainActivity } from "@/lib/source/brain/activity";
import { setTyping } from "@/lib/source/chats/http";
import type {
  Chat,
  MessageType,
  PendingMessage,
} from "@/lib/source/chats/types";
import { ChatFailure } from "./chat-failure";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { useTyping } from "@/lib/live/realtime-state";

/** The system admin's work is the player's to watch; a character's is theirs. */
const ADMIN_TURNS = 20;

export function ChatView({
  chat,
  onBack,
  onSent,
}: {
  chat: Chat;
  onBack: () => void;
  onSent: (chat: Chat) => void;
}) {
  const { byId } = useCharacters();
  const { canPlay } = useAccess();
  const { player, send, commitSentMessage, refreshChats } = useChatActions();
  const messagesState = useMessages(chat.draft ? null : chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const typists = useTyping(chat.id);

  const admin =
    chat.type === "direct" && !chat.draft
      ? chat.members.find((id) => byId.get(id)?.isSystemAgent)
      : undefined;
  const adminThinking = useCharacterStatus(admin)?.brain === "thinking";
  const { data: adminTrace } = useBrainTrace(admin, ADMIN_TURNS, adminThinking);
  const activity = useMemo(
    () =>
      adminTrace ? brainActivity(adminTrace.turns, messagesState.messages) : [],
    [adminTrace, messagesState.messages],
  );
  const others = useMemo(
    () => chat.members.filter((id) => id !== player.id),
    [chat.members, player.id],
  );

  const resolve = useParticipantResolver();

  const deliver = useCallback(
    async (message: PendingMessage) => {
      if (!canPlay) return;
      try {
        const response = await send(
          chat,
          message.text,
          message.requestId,
          message.type,
        );
        commitSentMessage(response.chatId, response.message);
        if (chat.draft) {
          onSent({
            ...chat,
            id: response.chatId,
            sessionKey: response.sessionKey,
            draft: false,
          });
          void refreshChats();
        }
        setPending((current) => current.filter((m) => m.id !== message.id));
      } catch (error) {
        setPending((current) =>
          current.map((m) =>
            m.id === message.id ? { ...m, status: "failed" } : m,
          ),
        );
        toast.error("Message not delivered", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [chat, send, commitSentMessage, onSent, refreshChats],
  );

  function handleSend(text: string, type: MessageType) {
    if (!canPlay) return;
    const requestId = crypto.randomUUID();
    const message: PendingMessage = {
      id: requestId,
      requestId,
      senderId: player.id,
      senderName: player.name,
      text,
      ...(type === "action" ? { type } : {}),
      timestamp: readSimNow(),
      status: "sending",
    };
    setPending((current) => [...current, message]);
    void deliver(message);
  }

  function handleRetry(message: PendingMessage) {
    if (!canPlay) return;
    const retried: PendingMessage = { ...message, status: "sending" };
    setPending((current) =>
      current.map((m) => (m.id === message.id ? retried : m)),
    );
    void deliver(retried);
  }

  // The server may echo our own message over SSE before the POST resolves.
  const visiblePending = pending.filter(
    (candidate) =>
      !messagesState.messages.some(
        (m) =>
          m.senderId === candidate.senderId &&
          m.requestId === candidate.requestId,
      ),
  );

  const handleTyping = useCallback(
    (isTyping: boolean) => {
      if (!canPlay || chat.draft) return;
      void setTyping({
        sessionKey: chat.sessionKey,
        isTyping,
      }).catch(() => {});
    },
    [canPlay, chat.draft, chat.sessionKey],
  );

  return (
    <section
      aria-label={chat.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ChatHeader
        chat={chat}
        own={chat.draft ? undefined : chat}
        userId={player.id}
        typists={typists}
        onBack={onBack}
      />

      <MessageList
        chat={chat}
        messages={messagesState.messages}
        pending={visiblePending}
        typists={typists}
        isLoading={messagesState.isLoading}
        error={messagesState.error}
        hasMore={messagesState.hasMore}
        isLoadingOlder={messagesState.isLoadingOlder}
        onLoadOlder={messagesState.loadOlder}
        onRetry={handleRetry}
        resolve={resolve}
        userId={player.id}
        activity={activity}
        activityRunning={adminThinking}
      />

      <ChatFailure members={others} />

      <Composer
        placeholder={
          chat.type === "huddle" ? "Say something" : `Message ${chat.name}`
        }
        canAct={canPlay && chat.type === "huddle"}
        onSend={handleSend}
        onTyping={handleTyping}
        disabled={!canPlay || (chat.draft && pending.length > 0)}
      />
    </section>
  );
}
