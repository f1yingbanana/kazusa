"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/use-access";
import { readSimNow } from "@/hooks/use-clock";
import { useChatActions, useMessages } from "@/hooks/use-chats";
import { useSelfIn } from "@/hooks/use-self";
import { setTyping } from "@/lib/source/chats/http";
import type {
  Chat,
  MessageType,
  PendingMessage,
} from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";

export interface ReplyProps {
  readonly chatId: string;
  readonly canAct: boolean;
  readonly onSend: (text: string, type: MessageType) => void;
  readonly onTyping: (isTyping: boolean) => void;
  readonly disabled: boolean;
}

/**
 * One of your own conversations: its history, the lines on their way (kept
 * until the server's copy arrives, by SSE or the send's answer, whichever is
 * first), retries, typing signals, and one reply box's props whichever box
 * draws them. A draft's first send makes it real (`onSent`).
 */
export function useConversation(
  chat: Chat,
  {
    onSent,
    beforeSend,
    onFailed,
  }: {
    onSent: (chat: Chat) => void;
    /** Runs as a line leaves; what it returns, once it has landed or failed. */
    beforeSend?: () => () => void;
    /** A line didn't go: what the failure toast offers beside it. */
    onFailed?: { label: string; run: () => void };
  },
) {
  const { canPlay } = useAccess();
  const { player, send, commitSentMessage, refreshChats } = useChatActions();
  const { operator } = useSources();
  const selfOf = useSelfIn();
  const history = useMessages(chat.draft ? null : chat.id);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  // In the console, "you" is the person; elsewhere, who they play.
  const self = selfOf(chat);
  const selfName = self === operator.id ? operator.name : player.name;
  const others = useMemo(
    () => chat.members.filter((id) => id !== self),
    [chat.members, self],
  );

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
          ...(onFailed
            ? { action: { label: onFailed.label, onClick: onFailed.run } }
            : {}),
        });
      }
    },
    [canPlay, chat, send, commitSentMessage, onSent, refreshChats, onFailed],
  );

  const sendLine = (text: string, type: MessageType) => {
    if (!canPlay) return;
    const requestId = crypto.randomUUID();
    const message: PendingMessage = {
      id: requestId,
      requestId,
      senderId: self,
      senderName: selfName,
      text,
      ...(type === "action" ? { type } : {}),
      timestamp: readSimNow(),
      status: "sending",
    };
    setPending((current) => [...current, message]);
    const landed = beforeSend?.();
    void deliver(message).finally(landed);
  };

  const retry = (message: PendingMessage) => {
    // Never sent as someone else: a line written as another character stays
    // theirs, even when the talk stays open across the switch.
    if (!canPlay || message.senderId !== self) return;
    const retried: PendingMessage = { ...message, status: "sending" };
    setPending((current) =>
      current.map((m) => (m.id === message.id ? retried : m)),
    );
    const landed = beforeSend?.();
    void deliver(retried).finally(landed);
  };

  const onTyping = useCallback(
    (isTyping: boolean) => {
      if (!canPlay || chat.draft) return;
      void setTyping({ sessionKey: chat.sessionKey, isTyping }).catch(() => {});
    },
    [canPlay, chat.draft, chat.sessionKey],
  );

  // The server may echo our own message over SSE before the POST resolves.
  // A line written as a character played before isn't this one's to retry.
  const visiblePending = pending.filter(
    (candidate) =>
      candidate.senderId === self &&
      !history.messages.some(
        (m) =>
          m.senderId === candidate.senderId &&
          m.requestId === candidate.requestId,
      ),
  );

  const reply: ReplyProps = {
    chatId: chat.id,
    canAct: canPlay && chat.type === "huddle",
    onSend: sendLine,
    onTyping,
    disabled: !canPlay || (Boolean(chat.draft) && pending.length > 0),
  };

  return {
    history,
    pending: visiblePending,
    retry,
    reply,
    self,
    others,
    canPlay,
  };
}
