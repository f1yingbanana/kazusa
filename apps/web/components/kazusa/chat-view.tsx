"use client";

import { useCallback, useState } from "react";
import { ChevronLeftIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAgents, useChatActions, useMessages } from "@/hooks/use-kazusa";
import { formatTypingLabel } from "@/lib/kazusa/format";
import { setTyping } from "@/lib/kazusa/api";
import type { Chat, PendingMessage } from "@/lib/kazusa/types";
import { ChatAvatar, resolveParticipant } from "./chat-avatar";
import { Composer } from "./composer";
import { MembersSheet } from "./members-sheet";
import { MessageList } from "./message-list";
import { useRealtime } from "./realtime-provider";

export function ChatView({
  chat,
  onBack,
  onSent,
}: {
  chat: Chat;
  onBack: () => void;
  onSent: (chat: Chat) => void;
}) {
  const { agents, agentsById } = useAgents();
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
        void setTyping(config.baseUrl, {
          sessionKey: chat.sessionKey,
          isTyping,
        }).catch(() => {});
    },
    [chat.draft, chat.sessionKey, config.baseUrl],
  );

  const otherMembers = chat.members.filter((id) => id !== config.userId);
  const agentCount = otherMembers.filter((id) => agentsById.has(id)).length;
  const subtitle =
    typists.length > 0
      ? formatTypingLabel(typists.map((t) => t.senderName))
      : isGroup
        ? `${chat.members.length} members · ${agentCount} ${agentCount === 1 ? "agent" : "agents"}`
        : (otherMembers[0] ?? "Direct message");

  return (
    <section
      aria-label={chat.name}
      className="flex h-dvh min-w-0 flex-1 flex-col"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-2 md:px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          <span className="sr-only">Back to conversations</span>
        </Button>
        <ChatAvatar
          chat={chat}
          agentsById={agentsById}
          userId={config.userId}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{chat.name}</h2>
          <p
            className={
              typists.length > 0
                ? "shimmer truncate text-xs text-primary"
                : "truncate font-mono text-xs text-muted-foreground"
            }
          >
            {subtitle}
          </p>
        </div>
        {isGroup && !chat.draft ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMembersOpen(true)}
          >
            <UsersIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Members</span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {chat.members.length}
            </span>
          </Button>
        ) : null}
      </header>

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
