"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { Composer, ReplyRow } from "./composer";
import { MessageList } from "./message-list";
import { Backlog } from "./scene/backlog";
import { FullscreenControls } from "./scene/fullscreen-controls";
import { SceneView } from "./scene/scene-view";
import { useChatRendering } from "./scene/use-chat-rendering";
import { useReadingMode } from "./scene/use-reading-mode";
import { useSceneFullscreen } from "./scene/use-scene-fullscreen";
import { cn } from "@/lib/utils";
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
  const rendering = useChatRendering(chat);
  // The scene, with its notice and reply row inside: what full screen shows.
  const stage = useRef<HTMLDivElement>(null);
  const fullscreen = useSceneFullscreen(stage, rendering.as === "scene");
  const mode = useReadingMode(
    chat.id,
    rendering.as === "scene" && !chat.draft,
    others,
  );
  // The transcript over the scene; only while the scene shows.
  const [backlog, setBacklog] = useState(false);
  if (backlog && rendering.as !== "scene") setBacklog(false);
  const openBacklog = useCallback(() => setBacklog(true), []);
  const closeBacklog = useCallback(() => setBacklog(false), []);
  const readingToggle = mode.available
    ? { on: mode.on, onToggle: mode.toggle }
    : undefined;

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
          // The scene shows no unsent lines: the backlog has it, with Retry.
          ...(rendering.as === "scene"
            ? { action: { label: "Show", onClick: openBacklog } }
            : {}),
        });
      }
    },
    [
      chat,
      send,
      commitSentMessage,
      onSent,
      refreshChats,
      rendering.as,
      openBacklog,
    ],
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
    // Reading mode: what waited shows first; once it is sent, the world runs.
    const sent = mode.beforeSend();
    void deliver(message).finally(sent);
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

  // One draft and one way to send, whichever box shows: the transcript's card
  // or the scene's reply row.
  const reply = {
    chatId: chat.id,
    canAct: canPlay && chat.type === "huddle",
    onSend: handleSend,
    onTyping: handleTyping,
    disabled: !canPlay || (chat.draft && pending.length > 0),
  };

  // The transcript, under the composer or as the scene's backlog.
  const transcript = (
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
        rendering={rendering}
        onFullscreen={rendering.as === "scene" ? fullscreen.enter : undefined}
        reading={readingToggle}
      />

      <div
        ref={stage}
        data-fullscreen={fullscreen.mode}
        className={cn(
          "relative flex min-h-0 flex-1 flex-col",
          fullscreen.mode !== "off" && "bg-background",
          fullscreen.mode === "window" &&
            "fixed inset-0 z-40 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        )}
      >
        {fullscreen.mode === "off" ? null : (
          <FullscreenControls
            onExit={fullscreen.exit}
            container={stage}
            onBacklog={openBacklog}
            reading={readingToggle}
          />
        )}

        {rendering.as === "scene" ? (
          // The scene down to the bottom edge, the reply box in its panel.
          <SceneView
            chat={chat}
            loading={messagesState.isLoading}
            notice={<ChatFailure members={others} slim />}
            footer={<ReplyRow {...reply} />}
            reading={mode.on ? mode.status : undefined}
            onAdvance={mode.on && !backlog ? mode.advance : undefined}
            advanceable={mode.canAdvance}
            onBacklog={openBacklog}
          />
        ) : (
          <>
            {transcript}
            <ChatFailure members={others} />
            <Composer {...reply} placeholder={`Message ${chat.name}`} />
          </>
        )}

        {backlog ? (
          <Backlog onClose={closeBacklog}>{transcript}</Backlog>
        ) : null}
      </div>
    </section>
  );
}
