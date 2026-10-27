"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useCharacters } from "@/hooks/use-characters";
import { useChatActions, useMessages } from "@/hooks/use-chats";
import { setTyping } from "@/lib/source/chats/http";
import type { Chat, PendingMessage } from "@/lib/source/chats/types";
import { resolveParticipant } from "./chat-avatar";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { MembersSheet } from "./members-sheet";
import { MessageList } from "./message-list";
import { useRealtime } from "@/lib/live/realtime-provider";

export function ChatView({
  chat,
  onBack,
  onSent,
}: {
  chat: Chat;
  onBack: () => void;
  onSent: (chat: Chat) => void;
}) {
  const { characters, byId: agentsById } = useCharacters();
  const agents = characters.filter((character) => character.kind === "agent");
  const { config, send, commitSentMessage, refreshChats } = useChatActions();
  const { typingByChat } = useRealtime();
  const messagesState = useMessages(chat.draft ? null : chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);

  const typists = typingByChat[chat.id] ?? [];
  const isGroup = chat.type === "group";

  const resolve = useCallback(
    (id: string, fallbackName?: string) => {
      const participant = resolveParticipant(id, agentsById, {
        userId: config.userId,
        userName: config.userName,
      });
      if (!participant.isAgent && !participant.isSelf && fallbackName) {
        return { ...participant, name: fallbackName };
      }
      return participant;
    },
    [agentsById, config.userId, config.userName],
  );

  const deliver = useCallback(
    async (message: PendingMessage) => {
      try {
        const response = await send(chat, message.text, message.requestId);
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

  function handleSend(text: string) {
    const requestId = crypto.randomUUID();
    const message: PendingMessage = {
      id: requestId,
      requestId,
      senderId: config.userId,
      senderName: config.userName,
      text,
      timestamp: Date.now(),
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
        userId={config.userId}
        typists={typists}
        onBack={onBack}
        onOpenMembers={() => setMembersOpen(true)}
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
      />

      <Composer
        placeholder={`Message ${chat.name}`}
        onSend={handleSend}
        onTyping={handleTyping}
        disabled={chat.draft && pending.length > 0}
      />

      {isGroup && !chat.draft ? (
        <MembersSheet
          open={membersOpen}
          onOpenChange={setMembersOpen}
          chat={chat}
          agents={agents}
          resolve={resolve}
        />
      ) : null}
    </section>
  );
}
