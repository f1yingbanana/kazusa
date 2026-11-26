"use client";

import { EyeIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { useBrainTrace } from "@/hooks/use-brain";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useObservedMessages } from "@/hooks/use-observed-chats";
import { useParticipantResolver } from "@/hooks/use-participants";
import { useTyping } from "@/lib/live/realtime-state";
import { brainActivity } from "@/lib/source/brain/activity";
import type { Chat, ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { openVisitorWelcome } from "@/lib/state/ui-store";
import { COMPOSER_DOCK } from "@/ui/composer";
import { cx } from "@/ui/cx";
import { ConversationHeader } from "./conversation-header";
import { ChatAlone, ChatFailure, EmptyRoom } from "./notices";
import { ReplyBox } from "./reply-box";
import { Transcript } from "./transcript";
import { useConversation } from "./use-conversation";

/** The system admin's work is the player's to watch; a character's is theirs. */
const ADMIN_TURNS = 20;

/**
 * A text conversation you're in: who it's with, the transcript, and the reply
 * box floating over its foot. A draft becomes real on its first send.
 */
export function Conversation({
  chat,
  onSent,
  onTalkInPerson,
}: {
  chat: Chat;
  onSent: (chat: Chat) => void;
  onTalkInPerson: (id: string) => void;
}) {
  const { byId } = useCharacters();
  const typists = useTyping(chat.id);
  const resolve = useParticipantResolver();
  const { history, pending, retry, reply, self, others, canPlay } =
    useConversation(chat, { onSent });

  const admin =
    chat.type === "direct" && !chat.draft
      ? chat.members.find((id) => byId.get(id)?.isSystemAgent)
      : undefined;
  const adminThinking = useCharacterStatus(admin)?.brain === "thinking";
  const { data: trace } = useBrainTrace(admin, ADMIN_TURNS, adminThinking);
  const activity = useMemo(
    () => (trace ? brainActivity(trace.turns, history.messages) : []),
    [trace, history.messages],
  );
  const alone = !chat.draft && chat.type === "group" && others.length === 0;
  // Choosing a screenshot, nothing is sent: its bar takes the reply box's place.
  const [shooting, setShooting] = useState(false);

  return (
    <section
      aria-label={chat.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ConversationHeader
        chat={chat}
        userId={self}
        typists={typists}
        onTalkInPerson={onTalkInPerson}
      />
      <Transcript
        chat={chat}
        messages={history.messages}
        pending={pending}
        typists={typists}
        isLoading={history.isLoading}
        error={history.error}
        hasMore={history.hasMore}
        isLoadingOlder={history.isLoadingOlder}
        onLoadOlder={history.loadOlder}
        onRetry={retry}
        resolve={resolve}
        userId={self}
        activity={activity}
        activityRunning={adminThinking}
        after={alone ? <ChatAlone chat={chat} canAdd={canPlay} /> : null}
        onShooting={setShooting}
      />
      <div className={cx("shrink-0", COMPOSER_DOCK, shooting && "hidden")}>
        <ChatFailure members={others} />
        <ReplyBox
          {...reply}
          placeholder={`Message ${chat.name}`}
          className="mx-auto max-w-3xl"
        />
      </div>
    </section>
  );
}

/**
 * A text conversation you're not in, read from outside: no reply box, nothing
 * that passes for taking part, and a note that nobody in it can tell.
 */
export function ObservedConversation({ chat }: { chat: ChatInfo }) {
  const { player } = useSources();
  const messages = useObservedMessages(chat.id);
  const resolve = useParticipantResolver();
  const typists = useTyping(chat.id);
  const { isReadOnly, isLoading } = useAccess();
  const empty =
    !chat.ended && chat.type === "group" && chat.members.length === 0;

  return (
    <section
      aria-label={`${chat.name}, observing`}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ConversationHeader chat={chat} userId={player.id} typists={typists} />
      <Transcript
        chat={chat}
        observed
        messages={messages.messages}
        typists={typists}
        isLoading={messages.isLoading}
        error={messages.error}
        hasMore={messages.hasMore}
        isLoadingOlder={messages.isLoadingOlder}
        onLoadOlder={messages.loadOlder}
        resolve={resolve}
        userId={player.id}
      />
      {empty ? <EmptyRoom slim /> : null}
      <ObservingNote ended={chat.ended} visitor={isReadOnly && !isLoading} />
    </section>
  );
}

export function ObservingNote({
  ended,
  visitor,
  className,
}: {
  ended?: boolean;
  visitor: boolean;
  className?: string;
}) {
  return (
    <footer
      className={
        className ??
        "flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-ui-line px-4 py-3 text-xs font-semibold text-ui-soft"
      }
    >
      <EyeIcon aria-hidden className="size-3.5 shrink-0" />
      <span>
        {ended
          ? "Observing a conversation that has ended."
          : "Observing, read-only. Nobody here can tell."}
      </span>
      {visitor ? (
        <button
          type="button"
          className="font-bold text-ui-primary hover:underline"
          onClick={() => openVisitorWelcome()}
        >
          Talk to them in a world of your own
        </button>
      ) : null}
    </footer>
  );
}
