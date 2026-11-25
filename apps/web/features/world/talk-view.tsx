"use client";

import {
  BookOpenIcon,
  ChevronLeftIcon,
  ImageIcon,
  ListIcon,
  Maximize2Icon,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useAccess } from "@/hooks/use-access";
import { useClockActions } from "@/hooks/use-clock";
import { useObservedMessages } from "@/hooks/use-observed-chats";
import { useParticipantResolver } from "@/hooks/use-participants";
import { useSelfIn } from "@/hooks/use-self";
import { useTyping } from "@/lib/live/realtime-state";
import {
  canDrawScene,
  chatRendering,
  type ChatRendering,
} from "@/lib/scene/rendering";
import type { Chat, ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import {
  setHuddleRendering,
  useHuddleRendering,
} from "@/lib/state/preferences-store";
import { IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Reveal } from "@/ui/reveal";
import { COMPOSER_DOCK } from "@/ui/composer";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { ObservingNote } from "../chats/conversation";
import { ConversationHeader } from "../chats/conversation-header";
import { ChatAlone, ChatFailure, EmptyRoom } from "../chats/notices";
import { conversationParsers } from "../chats/open";
import { ReplyBox } from "../chats/reply-box";
import { Transcript } from "../chats/transcript";
import { useConversation } from "../chats/use-conversation";
import { useReadingMode } from "@/hooks/use-reading-mode";
import { useSceneFullscreen } from "@/hooks/use-scene-fullscreen";
import { Backlog } from "./scene/backlog";
import { FullscreenControls, READING_HINT } from "./scene/fullscreen-controls";
import { SceneView } from "./scene/scene-view";

/** The dialogue panel and the transcript's reply box: one morphs into the other. */
const REPLY_MORPH = "talk-reply";

/**
 * A talk drawn as a scene or as its transcript: the link's `world.as`, else
 * what this viewer chose last. Switching is a view transition, where the
 * browser has them: the dialogue panel folds down into the transcript's reply
 * box (or grows back out of it) while the rest crossfades.
 */
function useTalkRendering(chat: Pick<ChatInfo, "type" | "draft">) {
  const [explicit, setExplicit] = useQueryState(
    "world.as",
    conversationParsers["world.as"].withOptions({ history: "replace" }),
  );
  // The choice at once, for the transition's new frame; the link follows.
  const [chosen, setChosen] = useState<ChatRendering | null>(null);
  if (chosen !== null && explicit === chosen) setChosen(null);
  const preferred = useHuddleRendering();
  const as = chatRendering({
    type: chat.type,
    draft: chat.draft,
    explicit: chosen ?? explicit,
    preferred,
  });
  const setAs = useCallback(
    (next: ChatRendering) => {
      const apply = () => {
        flushSync(() => {
          setChosen(next);
          setHuddleRendering(next);
        });
        void setExplicit(next);
      };
      if (
        !document.startViewTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        apply();
      else
        // A hidden page, or a quick second switch, aborts it: the switch
        // itself still happens.
        document.startViewTransition(apply).ready.catch(() => {});
    },
    [setExplicit],
  );
  return { as, canScene: canDrawScene(chat), setAs };
}

/**
 * What a talk shares, yours or watched: the scene and its full screen, reading
 * mode and the backlog, with the header's tools. `body` draws what's left: the
 * scene's panel foot, or the transcript and what goes under it.
 */
function useTalkStage(chat: ChatInfo, members: readonly string[]) {
  const rendering = useTalkRendering(chat);
  const scene = rendering.as === "scene";
  const canLive = rendering.canScene && !chat.draft && !chat.ended;
  const live = scene && canLive;
  const clock = useClockActions();
  const stage = useRef<HTMLDivElement>(null);
  const fullscreen = useSceneFullscreen(stage, live);
  const reading = useReadingMode(chat.id, live, members);
  const [backlog, setBacklog] = useState(false);
  if (backlog && !scene) setBacklog(false);
  const openBacklog = useCallback(() => setBacklog(true), []);
  const closeBacklog = useCallback(() => setBacklog(false), []);
  const toggle = reading.available
    ? { on: reading.on, onToggle: reading.toggle }
    : undefined;

  // The scene's own tools, in full screen's order: they shrink away with the
  // scene, and swell back when it returns.
  const tools = (
    <>
      {canLive ? (
        <Reveal shown={live}>
          {clock.enabled ? (
            <IconButton
              label="Reading mode"
              title={READING_HINT}
              aria-pressed={reading.on}
              className={cx(reading.on && "bg-ui-tint text-ui-ink")}
              onClick={(event) => {
                // Focus off the button, so Space then advances the scene.
                if (!reading.on) event.currentTarget.blur();
                reading.toggle();
              }}
            >
              <BookOpenIcon aria-hidden />
            </IconButton>
          ) : null}
          <IconButton label="Full screen" onClick={fullscreen.enter}>
            <Maximize2Icon aria-hidden />
          </IconButton>
        </Reveal>
      ) : null}
      {rendering.canScene ? (
        <Segmented<ChatRendering>
          aria-label="Show as"
          value={rendering.as}
          onValueChange={(next) => next && rendering.setAs(next)}
          className="ms-1"
        >
          <SegmentedItem
            value="scene"
            aria-label="Scene"
            className="px-2.5 [&_svg]:size-4"
          >
            <ImageIcon aria-hidden />
          </SegmentedItem>
          <SegmentedItem
            value="list"
            aria-label="Transcript"
            className="px-2.5 [&_svg]:size-4"
          >
            <ListIcon aria-hidden />
          </SegmentedItem>
        </Segmented>
      ) : null}
    </>
  );

  return {
    scene,
    stage,
    fullscreen,
    reading,
    toggle,
    backlog,
    openBacklog,
    closeBacklog,
    tools,
  };
}

type Stage = ReturnType<typeof useTalkStage>;

/** The room the scene and its full screen fill. */
function StageBox({
  stage,
  transcript,
  children,
}: {
  stage: Stage;
  transcript: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      ref={stage.stage}
      data-fullscreen={stage.fullscreen.mode}
      className={cx(
        "relative flex min-h-0 flex-1 flex-col",
        stage.fullscreen.mode !== "off" && "bg-ui-ground",
        stage.fullscreen.mode === "window" &&
          "fixed inset-0 z-40 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
      )}
    >
      {stage.fullscreen.mode === "off" ? null : (
        <FullscreenControls
          onExit={stage.fullscreen.exit}
          onBacklog={stage.openBacklog}
          reading={stage.toggle}
        />
      )}
      {children}
      <Backlog open={stage.backlog} onClose={stage.closeBacklog}>
        {transcript}
      </Backlog>
    </div>
  );
}

function BackToMap({ onBack }: { onBack: () => void }) {
  return (
    <IconButton label="Back to the map" className="-ms-2" onClick={onBack}>
      <ChevronLeftIcon aria-hidden />
    </IconButton>
  );
}

/** Your own talk: a reply box in the scene's panel or under the transcript. */
export function OwnTalk({
  chat,
  onSent,
  onBack,
}: {
  chat: Chat;
  onSent: (chat: Chat) => void;
  onBack: () => void;
}) {
  const selfOf = useSelfIn();
  const self = selfOf(chat);
  const members = chat.members.filter((id) => id !== self);
  const stage = useTalkStage(chat, members);
  const typists = useTyping(chat.id);
  const resolve = useParticipantResolver();
  const { history, pending, retry, reply, others, canPlay } = useConversation(
    chat,
    {
      onSent,
      beforeSend: stage.reading.beforeSend,
      onFailed: stage.scene
        ? { label: "Show", run: stage.openBacklog }
        : undefined,
    },
  );
  const alone = !chat.draft && others.length === 0;
  const transcript = (
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
      after={
        alone && !stage.scene ? (
          <ChatAlone chat={chat} canAdd={canPlay} />
        ) : null
      }
    />
  );

  return (
    <section
      aria-label={chat.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ConversationHeader
        chat={chat}
        userId={self}
        typists={typists}
        leading={<BackToMap onBack={onBack} />}
        tools={stage.tools}
        inert={stage.fullscreen.mode === "window"}
      />
      <StageBox stage={stage} transcript={transcript}>
        {stage.scene ? (
          <SceneView
            chat={chat}
            loading={history.isLoading}
            notice={
              alone ? (
                <ChatAlone chat={chat} canAdd={canPlay} onScene />
              ) : (
                <ChatFailure members={others} onScene />
              )
            }
            footer={<ReplyBox {...reply} flat />}
            morph={REPLY_MORPH}
            reading={stage.reading.on ? stage.reading.status : undefined}
            onAdvance={
              stage.reading.on && !stage.backlog
                ? stage.reading.advance
                : undefined
            }
            advanceable={stage.reading.canAdvance}
            onBacklog={stage.openBacklog}
          />
        ) : (
          <>
            {transcript}
            <div className={cx("shrink-0", COMPOSER_DOCK)}>
              <ChatFailure members={others} />
              <div className="relative mx-auto max-w-3xl">
                <ReplyBox {...reply} morph={REPLY_MORPH} />
                {/* Where the speaker's plate would sit on this box: in the
                    switch, the scene's plate travels from or to here. After
                    the box, so it passes over it. */}
                <span
                  aria-hidden
                  style={{ viewTransitionName: `${REPLY_MORPH}-plate` }}
                  className="pointer-events-none absolute inset-s-3 -top-3 h-6 w-16 opacity-0"
                />
              </div>
            </div>
          </>
        )}
      </StageBox>
    </section>
  );
}

/** Someone else's talk, watched from outside. */
export function WatchedTalk({
  chat,
  onBack,
}: {
  chat: ChatInfo;
  onBack: () => void;
}) {
  const { player } = useSources();
  const stage = useTalkStage(chat, chat.members);
  const messages = useObservedMessages(chat.id);
  const resolve = useParticipantResolver();
  const typists = useTyping(chat.id);
  const { isReadOnly, isLoading } = useAccess();
  const visitor = isReadOnly && !isLoading;
  const empty = !chat.ended && chat.members.length === 0;
  const transcript = (
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
  );

  return (
    <section
      aria-label={`${chat.name}, observing`}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ConversationHeader
        chat={chat}
        userId={player.id}
        typists={typists}
        leading={<BackToMap onBack={onBack} />}
        tools={stage.tools}
        inert={stage.fullscreen.mode === "window"}
      />
      <StageBox stage={stage} transcript={transcript}>
        {stage.scene ? (
          <SceneView
            chat={chat}
            loading={messages.isLoading}
            notice={empty ? <EmptyRoom slim /> : undefined}
            footer={
              <ObservingNote
                ended={chat.ended}
                visitor={visitor}
                className="flex shrink-0 items-center gap-1.5 px-5 pb-2.5 text-xs font-semibold text-ui-soft"
              />
            }
            reading={stage.reading.on ? stage.reading.status : undefined}
            onAdvance={
              stage.reading.on && !stage.backlog
                ? stage.reading.advance
                : undefined
            }
            advanceable={stage.reading.canAdvance}
            onBacklog={stage.openBacklog}
          />
        ) : (
          <>
            {transcript}
            {empty ? <EmptyRoom slim /> : null}
            <ObservingNote ended={chat.ended} visitor={visitor} />
          </>
        )}
      </StageBox>
    </section>
  );
}
