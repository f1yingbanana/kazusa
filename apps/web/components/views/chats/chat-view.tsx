"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBrainTrace } from "@/hooks/use-brain";
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
import { useRealtime } from "@/lib/live/realtime-provider";

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
  const { config, send, commitSentMessage, refreshChats } = useChatActions();
  const { typingByChat } = useRealtime();
  const messagesState = useMessages(chat.draft ? null : chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const typists = typingByChat[chat.id] ?? [];

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
    () => chat.members.filter((id) => id !== config.userId),
    [chat.members, config.userId],
  );

  const resolve = useParticipantResolver();

  const deliver = useCallback(
    async (message: PendingMessage) => {
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
    const requestId = crypto.randomUUID();
    const message: PendingMessage = {
      id: requestId,
      requestId,
      senderId: config.userId,
      senderName: config.userName,
      text,
      ...(type === "action" ? { type } : {}),
      timestamp: readSimNow(),
      status: "sending",
    };
    setPending((current) => [...current, message]);
    void deliver(message);
  }

  function handleRetry(message: PendingMessage) {
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
      if (!chat.draft)
        void setTyping(
          config.baseUrl,
          {
            sessionKey: chat.sessionKey,
            isTyping,
          },
          config.token,
        ).catch(() => {});
    },
    [chat.draft, chat.sessionKey, config.baseUrl, config.token],
  );

  return (
    <section
      aria-label={chat.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ChatHeader
        chat={chat}
        own={chat.draft ? undefined : chat}
        userId={config.userId}
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
        userId={config.userId}
        activity={activity}
        activityRunning={adminThinking}
      />

      <ChatFailure members={others} />

      <Composer
        placeholder={
          chat.type === "huddle" ? "Say something" : `Message ${chat.name}`
        }
        canAct={chat.type === "huddle"}
        onSend={handleSend}
        onTyping={handleTyping}
        disabled={chat.draft && pending.length > 0}
      />
    </section>
  );
}
