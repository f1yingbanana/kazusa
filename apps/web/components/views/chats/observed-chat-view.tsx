"use client";

import { useCallback, useRef, useState } from "react";
import { EyeIcon } from "lucide-react";
import { useObservedMessages } from "@/hooks/use-observed-chats";
import { useParticipantResolver } from "@/hooks/use-participants";
import { useTyping } from "@/lib/live/realtime-state";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import { ChatHeader } from "./chat-header";
import { MessageList } from "./message-list";
import { Backlog } from "./scene/backlog";
import { FullscreenControls } from "./scene/fullscreen-controls";
import { SceneView } from "./scene/scene-view";
import { useChatRendering } from "./scene/use-chat-rendering";
import { useReadingMode } from "./scene/use-reading-mode";
import { useSceneFullscreen } from "./scene/use-scene-fullscreen";
import { cn } from "@/lib/utils";

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
  const rendering = useChatRendering(chat);
  // The scene, its read-only note inside: what full screen shows. A huddle
  // that has ended leaves it.
  const stage = useRef<HTMLDivElement>(null);
  const live = rendering.as === "scene" && !chat.ended;
  const fullscreen = useSceneFullscreen(stage, live);
  const mode = useReadingMode(chat.id, live, chat.members);
  const readingToggle = mode.available
    ? { on: mode.on, onToggle: mode.toggle }
    : undefined;
  // The transcript over the scene; only while the scene shows.
  const [backlog, setBacklog] = useState(false);
  if (backlog && rendering.as !== "scene") setBacklog(false);
  const openBacklog = useCallback(() => setBacklog(true), []);
  const closeBacklog = useCallback(() => setBacklog(false), []);

  const readOnly = chat.ended
    ? "Observing a conversation that has ended."
    : "Observing, read-only. Nobody here can tell.";

  // The transcript, as the view or as the scene's backlog.
  const transcript = (
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
  );

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
        rendering={rendering}
        onFullscreen={live ? fullscreen.enter : undefined}
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
          <SceneView
            chat={chat}
            loading={messages.isLoading}
            footer={
              <p className="flex shrink-0 items-center gap-1.5 px-5 pb-2.5 text-xs text-muted-foreground">
                <EyeIcon aria-hidden className="size-3.5 shrink-0" />
                {readOnly}
              </p>
            }
            reading={mode.on ? mode.status : undefined}
            onAdvance={mode.on && !backlog ? mode.advance : undefined}
            advanceable={mode.canAdvance}
            onBacklog={openBacklog}
          />
        ) : (
          <>
            {transcript}
            <footer className="flex shrink-0 items-center justify-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
              <EyeIcon aria-hidden className="size-3.5 shrink-0" />
              <span>{readOnly}</span>
            </footer>
          </>
        )}

        {backlog ? (
          <Backlog onClose={closeBacklog}>{transcript}</Backlog>
        ) : null}
      </div>
    </section>
  );
}
