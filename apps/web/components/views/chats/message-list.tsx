"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleAlertIcon, SparklesIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useCharacters } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { useSelection } from "@/hooks/use-url-state";
import { formatDayLabel } from "@/lib/format";
import type { ChatMessage } from "@kazusa/client";
import type { BrainActivity } from "@/lib/source/brain/activity";
import { isOneOnOne } from "@/lib/source/chats/display";
import {
  includedIn,
  pickMessage,
  type ShotRange,
} from "@/lib/source/chats/screenshot";
import type { ChatInfo, PendingMessage } from "@/lib/source/chats/types";
import { requestInspector } from "@/lib/state/inspector-request";
import { cn } from "@/lib/utils";
import { ParticipantAvatar, type Participant } from "./chat-avatar";
import { MessageActions, useLongPress } from "./message-actions";
import {
  ActionLine,
  buildRuns,
  MessageStatus,
  StickerImage,
} from "./message-parts";
import { ScreenshotDialog } from "./screenshot-dialog";
import {
  ScreenshotBar,
  ScreenshotFrame,
  ScreenshotReach,
} from "./screenshot-frame";
import { BrainActivityRows, BrainThinking } from "./tool-activity";
import type { Typist } from "@/lib/live/realtime-provider";

export function MessageList({
  chat,
  observed = false,
  messages,
  pending,
  typists,
  isLoading,
  error,
  hasMore,
  isLoadingOlder,
  onLoadOlder,
  onRetry,
  resolve,
  userId,
  activity = [],
  activityRunning = false,
}: {
  chat: ChatInfo;
  /** Read from outside: the empty state doesn't invite the player to speak. */
  observed?: boolean;
  messages: ChatMessage[];
  pending: PendingMessage[];
  typists: Typist[];
  isLoading: boolean;
  error?: Error;
  hasMore: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  onRetry: (message: PendingMessage) => void;
  resolve: (id: string, fallbackName?: string) => Participant;
  userId: string;
  /** The system admin's model calls, placed among its messages. */
  activity?: readonly BrainActivity[];
  activityRunning?: boolean;
}) {
  const simNow = useSimNow();
  // A long job grows inside the list, which message-by-message scrolling misses.
  const follow = useFollowBottom(activity.length > 0 || activityRunning);
  // Huddles and groups both need names on lines; only your own DM has one voice.
  const isGroup = !isOneOnOne(chat, userId);
  const empty = observed ? EMPTY_OBSERVED : EMPTY[chat.type];
  const activityBefore = new Map(
    activity.flatMap((group) =>
      group.beforeSequence === undefined
        ? []
        : [[group.beforeSequence, group] as const],
    ),
  );
  const trailing = activity.filter(
    (group) => group.beforeSequence === undefined,
  );
  const runs = buildRuns(
    [...messages, ...pending],
    (timestamp) => formatDayLabel(timestamp, simNow),
    activityBefore,
  );
  const pendingById = new Map(pending.map((message) => [message.id, message]));

  // Screenshot: a crop over the sent messages, kept by id so it survives
  // older pages loading above it and belongs to the chat it was made in.
  const [shot, setShot] = useState<{
    chatId: string;
    startId: string;
    endId: string;
  } | null>(null);
  /** Inside the frame but tapped out of the picture. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const ids = useMemo(() => messages.map((message) => message.id), [messages]);
  // Every row asks where it is while choosing; a scan each would be O(n²).
  const indexById = useMemo(
    () => new Map(ids.map((id, index) => [id, index])),
    [ids],
  );
  const indexOf = (id: string) => indexById.get(id) ?? -1;
  const start = shot?.chatId === chat.id ? indexOf(shot.startId) : -1;
  const end = shot?.chatId === chat.id ? indexOf(shot.endId) : -1;
  const range: ShotRange | undefined =
    start !== -1 && end !== -1 ? { start, end } : undefined;
  const shooting = range !== undefined;
  const chosen = useMemo(
    () =>
      start !== -1 && end !== -1
        ? includedIn(messages, { start, end }, excluded)
        : [],
    [messages, start, end, excluded],
  );
  const select = (next: ShotRange) =>
    setShot({
      chatId: chat.id,
      startId: ids[next.start],
      endId: ids[next.end],
    });
  const stopShooting = () => {
    setShot(null);
    setExporting(false);
  };
  const press = useLongPress(setMenuFor);

  useEffect(() => {
    if (!shooting || exporting) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShot(null);
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [shooting, exporting]);

  /**
   * While choosing, a click on a message changes the screenshot and nothing
   * else in the transcript responds: `pickMessage` has the rules (reach one
   * outside, give up an end, leave one out inside).
   */
  const pickClicked = (event: React.MouseEvent) => {
    if (!range) return;
    const id = (event.target as Element)
      .closest("[data-shot-id]")
      ?.getAttribute("data-shot-id");
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    pick(id);
  };
  const pick = (id: string) => {
    const index = indexOf(id);
    if (!range || index === -1) return;
    const next = pickMessage(ids, { range, excluded }, index);
    select(next.range);
    setExcluded(next.excluded);
  };

  /** What a sent message can do; nothing while choosing a screenshot. */
  const actionsFor = (
    message: Pick<ChatMessage, "id" | "text">,
    align: "start" | "end",
  ) =>
    shooting ? null : (
      <MessageActions
        text={message.text}
        align={align}
        open={menuFor === message.id}
        onClose={() => setMenuFor(null)}
        onScreenshot={() => {
          const index = indexOf(message.id);
          if (index === -1) return;
          setExcluded(new Set());
          select({ start: index, end: index });
        }}
      />
    );
  /**
   * A sent message's row: pressable on touch, and inside the frame a checkbox
   * for whether it goes in the picture, so its state is announced and the
   * keyboard can change it, not only seen as dimmed or not.
   */
  const rowProps = (id: string) => {
    const index = range ? indexOf(id) : -1;
    const inFrame = range && index >= range.start && index <= range.end;
    return {
      "data-shot-id": id,
      ...(inFrame
        ? {
            "data-shot-in": "",
            role: "checkbox",
            "aria-checked": !excluded.has(id),
            tabIndex: 0,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              pick(id);
            },
          }
        : {}),
      ...press(id),
    };
  };

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport
          ref={follow.scroller}
          onScroll={follow.onScroll}
        >
          <MessageScrollerContent
            ref={follow.content}
            onClickCapture={pickClicked}
            className={cn(
              "relative mx-auto w-full max-w-3xl gap-4 px-4 pt-6 pb-4",
              shooting &&
                "pb-28 select-none [&_[data-shot-id]]:cursor-pointer [&_[data-shot-in]]:rounded-lg [&_[data-shot-in]:focus-visible]:outline-2 [&_[data-shot-in]:focus-visible]:outline-offset-4 [&_[data-shot-in]:focus-visible]:outline-ring",
            )}
          >
            {range ? (
              <ScreenshotFrame
                ids={ids}
                range={range}
                excluded={excluded}
                onChange={select}
              />
            ) : null}
            {hasMore ? (
              <MessageScrollerItem
                messageId="load-older"
                className="flex justify-center"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLoadOlder}
                  disabled={isLoadingOlder}
                >
                  {isLoadingOlder ? <Spinner data-icon="inline-start" /> : null}
                  Load earlier messages
                </Button>
              </MessageScrollerItem>
            ) : null}

            {isLoading ? (
              <MessageScrollerItem messageId="loading">
                <LoadingTranscript />
              </MessageScrollerItem>
            ) : null}

            {error && !isLoading ? (
              <MessageScrollerItem messageId="error">
                <Marker>
                  <MarkerIcon>
                    <CircleAlertIcon />
                  </MarkerIcon>
                  <MarkerContent>{error.message}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}

            {!isLoading && !error && runs.length === 0 ? (
              <MessageScrollerItem
                messageId="empty"
                className="flex flex-1 items-center"
              >
                <Empty className="border-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SparklesIcon />
                    </EmptyMedia>
                    <EmptyTitle>{empty.title(chat.name)}</EmptyTitle>
                    <EmptyDescription>{empty.description}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            ) : null}

            {runs.map((run) => {
              const participant = resolve(run.senderId, run.senderName);
              const isSelf = run.senderId === userId;
              const align = isSelf ? "end" : "start";
              const first = run.messages[0];
              const before =
                first && "sequence" in first
                  ? activityBefore.get(first.sequence)
                  : undefined;

              return (
                <Fragment key={run.key}>
                  {before ? (
                    <MessageScrollerItem messageId={before.key}>
                      <BrainActivityRows activity={before} running={false} />
                    </MessageScrollerItem>
                  ) : null}
                  {run.dayLabel ? (
                    <MessageScrollerItem messageId={`day-${run.key}`}>
                      <Marker variant="separator" className="text-xs">
                        <MarkerContent>{run.dayLabel}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
                  {run.isAction ? (
                    <MessageScrollerItem
                      messageId={run.key}
                      className={HOLDS_MENU}
                    >
                      <div
                        className={cn(
                          "flex flex-col gap-1",
                          isSelf ? "items-end text-right" : "pl-10",
                        )}
                      >
                        {run.messages.map((message, index) => {
                          const pendingMessage = pendingById.get(message.id);
                          return (
                            <ActionLine
                              key={message.id}
                              name={participant.name}
                              message={message}
                              pending={pendingMessage}
                              onRetry={onRetry}
                              nameOf={
                                isSelf && index === run.messages.length - 1
                                  ? (id) => resolve(id).name
                                  : undefined
                              }
                              className={cn(
                                "group/message relative",
                                PRESSABLE,
                              )}
                              {...(pendingMessage ? {} : rowProps(message.id))}
                            >
                              {pendingMessage
                                ? null
                                : actionsFor(message, align)}
                            </ActionLine>
                          );
                        })}
                      </div>
                    </MessageScrollerItem>
                  ) : (
                    <MessageScrollerItem
                      messageId={run.key}
                      className={HOLDS_MENU}
                    >
                      <MessageGroup className="gap-1">
                        {run.messages.map((message, index) => {
                          const isFirst = index === 0;
                          const isLast = index === run.messages.length - 1;
                          const pendingMessage = pendingById.get(message.id);

                          return (
                            <Message
                              key={message.id}
                              align={align}
                              className={PRESSABLE}
                              {...(pendingMessage ? {} : rowProps(message.id))}
                            >
                              {!isSelf ? (
                                isLast ? (
                                  <SenderAvatar participant={participant} />
                                ) : (
                                  <div aria-hidden className="w-8 shrink-0" />
                                )
                              ) : null}
                              <MessageContent className="gap-1">
                                {isFirst &&
                                isGroup &&
                                !isSelf &&
                                !run.introduced ? (
                                  <MessageHeader>
                                    {participant.name}
                                  </MessageHeader>
                                ) : null}
                                {message.type === "sticker" &&
                                message.sticker ? (
                                  <div
                                    data-slot="sticker"
                                    className="relative w-fit"
                                  >
                                    <StickerImage
                                      url={message.sticker.url}
                                      alt={message.text}
                                    />
                                    {actionsFor(message, align)}
                                  </div>
                                ) : (
                                  <Bubble
                                    align={align}
                                    variant={
                                      pendingMessage?.status === "failed"
                                        ? "destructive"
                                        : isSelf
                                          ? "default"
                                          : "secondary"
                                    }
                                    className={
                                      pendingMessage?.status === "sending"
                                        ? "opacity-70"
                                        : undefined
                                    }
                                  >
                                    <BubbleContent className="whitespace-pre-wrap">
                                      {message.text}
                                    </BubbleContent>
                                    {pendingMessage
                                      ? null
                                      : actionsFor(message, align)}
                                  </Bubble>
                                )}
                                {isLast ? (
                                  <MessageFooter className="h-4 gap-2 font-normal">
                                    <MessageStatus
                                      message={message}
                                      pending={pendingMessage}
                                      onRetry={onRetry}
                                      nameOf={
                                        isSelf
                                          ? (id) => resolve(id).name
                                          : undefined
                                      }
                                      inPerson={chat.type === "huddle"}
                                    />
                                  </MessageFooter>
                                ) : null}
                              </MessageContent>
                            </Message>
                          );
                        })}
                      </MessageGroup>
                    </MessageScrollerItem>
                  )}
                </Fragment>
              );
            })}

            {trailing.map((group) => (
              <MessageScrollerItem key={group.key} messageId={group.key}>
                <BrainActivityRows activity={group} running={activityRunning} />
              </MessageScrollerItem>
            ))}

            {activityRunning ? (
              <MessageScrollerItem messageId="brain-thinking">
                <BrainThinking />
              </MessageScrollerItem>
            ) : null}

            {typists.map((typist) => {
              const participant = resolve(typist.senderId, typist.senderName);
              return (
                <MessageScrollerItem
                  key={`typing-${typist.senderId}`}
                  messageId={`typing-${typist.senderId}`}
                >
                  <Message align="start">
                    <SenderAvatar participant={participant} />
                    <MessageContent className="gap-1">
                      {isGroup ? (
                        <MessageHeader>{participant.name}</MessageHeader>
                      ) : null}
                      <Bubble variant="secondary">
                        <BubbleContent>
                          <span className="shimmer" aria-live="polite">
                            {typist.mode === "speaking"
                              ? "…"
                              : `${isGroup ? "Typing" : `${participant.name} is typing`}…`}
                          </span>
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {range ? (
          <>
            <ScreenshotReach ids={ids} range={range} onChange={select} />
            <ScreenshotBar
              count={chosen.length}
              onCancel={stopShooting}
              onCreate={() => setExporting(true)}
            />
          </>
        ) : (
          <MessageScrollerButton />
        )}
      </MessageScroller>
      <ScreenshotDialog
        open={shooting && exporting}
        onOpenChange={setExporting}
        onDone={stopShooting}
        chat={chat}
        messages={chosen}
        userId={userId}
        resolve={resolve}
      />
    </MessageScrollerProvider>
  );
}

/**
 * Off-screen items skip painting and clip to their box; a touch menu rises
 * above its bubble, out of that box, so its item paints in full while open.
 */
const HOLDS_MENU =
  "has-[[role=toolbar][data-open]]:[content-visibility:visible]";

/** On touch, holding a message opens its actions, not the text selection. */
const PRESSABLE =
  "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]";

const EMPTY = {
  direct: {
    title: (name: string) => `Say hello to ${name}`,
    description: "Messages here are private between you and this character.",
  },
  group: {
    title: (name: string) => `Welcome to ${name}`,
    description: "Everyone in this group sees your message and can reply.",
  },
  huddle: {
    title: () => "Nobody has spoken yet",
    description: "You are talking face to face: everyone here can hear you.",
  },
} as const;

const EMPTY_OBSERVED = {
  title: () => "Nothing said yet",
  description: "Messages appear here as they are sent.",
} as const;

/*
 * Where the sender's avatar sits: centered on the bubble's last line, which
 * makes it centered on a one-line bubble. The line's middle is the bubble's
 * border (1px), bottom padding (0.5rem) and half its line (text-sm relaxed:
 * 0.875rem × 1.625 / 2) above the bubble's foot; the 2rem avatar's middle is
 * 1rem above its own. Under a footer (h-4 plus the gap-1 above it) the avatar
 * rises 1.25rem more. The kit's own lift (2rem) overshot a one-line bubble,
 * past the group's `content-visibility` box, which clipped the avatar's top.
 */
const AVATAR_LIFT =
  "translate-y-[calc(-1*(1px+0.2109375rem))] group-has-data-[slot=message-footer]/message:translate-y-[calc(-1*(1px+1.4609375rem))]";

/** The sender's face beside their bubble; a character's opens their details. */
function SenderAvatar({ participant }: { participant: Participant }) {
  const { byId } = useCharacters();
  const [, select] = useSelection();
  const face = <ParticipantAvatar participant={participant} />;
  const character = participant.isSelf ? undefined : byId.get(participant.id);
  return (
    <MessageAvatar className={AVATAR_LIFT}>
      {character ? (
        <button
          type="button"
          onClick={() => {
            select({ kind: "character", id: character.id });
            requestInspector();
          }}
          // Inset: the avatar's frame clips anything outside the circle.
          className="rounded-full outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {face}
          <span className="sr-only">{`About ${character.name}`}</span>
        </button>
      ) : (
        face
      )}
    </MessageAvatar>
  );
}

function LoadingTranscript() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex items-end gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-10 w-2/5 rounded-xl" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/3 rounded-xl" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-16 w-1/2 rounded-xl" />
      </div>
    </div>
  );
}
