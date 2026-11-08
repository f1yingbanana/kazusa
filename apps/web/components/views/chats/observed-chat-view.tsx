"use client";

import { EyeIcon } from "lucide-react";
import { useObservedMessages } from "@/hooks/use-observed-chats";
import { useParticipantResolver } from "@/hooks/use-participants";
import { useTyping } from "@/lib/live/realtime-state";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";

const NO_PENDING: never[] = [];
const noRetry = () => {};

/**
 * A chat the player isn't in, read from outside: no composer, no typing signal,
 * no member management, and a surface that doesn't pass for taking part.
 */
export function ObservedChatView({
  chat,
  onBack,
}: {
  chat: ChatInfo;
  onBack: () => void;
}) {
  const { player } = useSources();
  const messages = useObservedMessages(chat.id);
  const resolve = useParticipantResolver();
  const typists = useTyping(chat.id);

  return (
    <section
      aria-label={`${chat.name}, observing`}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40"
    >
      <ChatHeader
        chat={chat}
        userId={player.id}
        typists={typists}
        onBack={onBack}
      />

      <MessageList
        chat={chat}
        observed
        messages={messages.messages}
        pending={NO_PENDING}
        typists={typists}
        isLoading={messages.isLoading}
        error={messages.error}
        hasMore={messages.hasMore}
        isLoadingOlder={messages.isLoadingOlder}
        onLoadOlder={messages.loadOlder}
        onRetry={noRetry}
        resolve={resolve}
        userId={player.id}
      />

      <footer className="flex shrink-0 items-center justify-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <EyeIcon aria-hidden className="size-3.5 shrink-0" />
        <span>
          {chat.ended
            ? "Observing a conversation that has ended."
            : "Observing, read-only. Nobody here can tell."}
        </span>
      </footer>
    </section>
  );
}
