"use client";

import { Fragment } from "react";
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
import { useSimNow } from "@/hooks/use-clock";
import { useFollowBottom } from "@/hooks/use-follow-bottom";
import { formatDayLabel, formatTime, isSameDay } from "@/lib/format";
import type { ChatMessage } from "@kazusa/client";
import type { BrainActivity } from "@/lib/source/brain/activity";
import { actionLine, isOneOnOne } from "@/lib/source/chats/display";
import type { ChatInfo, PendingMessage } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import { ParticipantAvatar, type Participant } from "./chat-avatar";
import { BrainActivityRows, BrainThinking } from "./tool-activity";
import type { Typist } from "@/lib/live/realtime-provider";

const RUN_GAP_MS = 5 * 60 * 1000;

type DisplayMessage = (ChatMessage & { status?: never }) | PendingMessage;

type Run = {
  key: string;
  /** Actions are narrated, never bubbled, so they never share a run with speech. */
  isAction: boolean;
  senderId: string;
  senderName: string;
  messages: DisplayMessage[];
  dayLabel: string | null;
  /** Right after the same sender's action, which already named them. */
  introduced: boolean;
};

function buildRuns(
  messages: DisplayMessage[],
  simNow: number,
  /** Messages with something shown just before them start a new run. */
  startsRun: ReadonlyMap<number, BrainActivity>,
) {
  const runs: Run[] = [];
  let previous: DisplayMessage | null = null;

  for (const message of messages) {
    const isAction = message.type === "action";
    const newDay =
      !previous || !isSameDay(previous.timestamp, message.timestamp);
    const current = runs[runs.length - 1];
    const continues =
      current &&
      !newDay &&
      previous &&
      current.isAction === isAction &&
      previous.senderId === message.senderId &&
      message.timestamp - previous.timestamp < RUN_GAP_MS &&
      !previous.status === !message.status &&
      !("sequence" in message && startsRun.has(message.sequence));

    if (continues) {
      current.messages.push(message);
    } else {
      runs.push({
        key: message.id,
        isAction,
        senderId: message.senderId,
        senderName: message.senderName,
        messages: [message],
        dayLabel: newDay ? formatDayLabel(message.timestamp, simNow) : null,
        introduced:
          !newDay &&
          Boolean(current?.isAction) &&
          current?.senderId === message.senderId,
      });
    }
    previous = message;
  }
  return runs;
}

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
  const runs = buildRuns([...messages, ...pending], simNow, activityBefore);
  const pendingById = new Map(pending.map((message) => [message.id, message]));

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport
          ref={follow.scroller}
          onScroll={follow.onScroll}
        >
          <MessageScrollerContent
            ref={follow.content}
            className="mx-auto w-full max-w-3xl gap-4 px-4 pt-6 pb-4"
          >
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
                    <MessageScrollerItem messageId={run.key}>
                      <div
                        className={cn(
                          "flex flex-col gap-1",
                          isSelf ? "items-end text-right" : "pl-10",
                        )}
                      >
                        {run.messages.map((message) => (
                          <ActionLine
                            key={message.id}
                            name={participant.name}
                            message={message}
                            pending={pendingById.get(message.id)}
                            onRetry={onRetry}
                          />
                        ))}
                      </div>
                    </MessageScrollerItem>
                  ) : (
                    <MessageScrollerItem messageId={run.key}>
                      <MessageGroup className="gap-1">
                        {run.messages.map((message, index) => {
                          const isFirst = index === 0;
                          const isLast = index === run.messages.length - 1;
                          const pendingMessage = pendingById.get(message.id);

                          return (
                            <Message key={message.id} align={align}>
                              {!isSelf ? (
                                isLast ? (
                                  <MessageAvatar>
                                    <ParticipantAvatar
                                      participant={participant}
                                    />
                                  </MessageAvatar>
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
                                  <StickerImage
                                    url={message.sticker.url}
                                    alt={message.text}
                                  />
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
                                  </Bubble>
                                )}
                                {isLast ? (
                                  <MessageFooter className="gap-2 font-normal">
                                    <MessageStatus
                                      message={message}
                                      pending={pendingMessage}
                                      onRetry={onRetry}
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
                    <MessageAvatar>
                      <ParticipantAvatar participant={participant} />
                    </MessageAvatar>
                    <MessageContent className="gap-1">
                      {isGroup ? (
                        <MessageHeader>{participant.name}</MessageHeader>
                      ) : null}
                      <Bubble variant="secondary">
                        <BubbleContent>
                          <span className="shimmer" aria-live="polite">
                            {chat.type === "huddle"
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
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

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

/**
 * Something done rather than said, narrated in third person ("Kazusa leans
 * back. She sips her tea."). The stored text leaves out the subject; the name
 * is set upright so the line still reads as one sentence.
 */
function ActionLine({
  name,
  message,
  pending,
  onRetry,
}: {
  name: string;
  message: DisplayMessage;
  pending?: PendingMessage;
  onRetry: (message: PendingMessage) => void;
}) {
  const line = actionLine(name, message.text);
  return (
    <div className="flex max-w-[80%] flex-col gap-0.5">
      <p
        title={formatTime(message.timestamp)}
        className={cn(
          "text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground italic",
          pending?.status === "sending" && "opacity-70",
          pending?.status === "failed" && "text-destructive",
        )}
      >
        <span className="font-medium text-foreground not-italic">
          {line.subject}
        </span>
        {line.rest}
      </p>
      {pending ? (
        <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <MessageStatus
            message={message}
            pending={pending}
            onRetry={onRetry}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * A character's sticker: the picture alone, without a bubble. Its text is what
 * it shows, as everyone in the chat reads it.
 */
function StickerImage({ url, alt }: { url: string; alt: string }) {
  return (
    <img
      src={url}
      alt={alt}
      title={alt}
      width={128}
      height={128}
      loading="lazy"
      draggable={false}
      className="size-32 object-contain"
    />
  );
}

function MessageStatus({
  message,
  pending,
  onRetry,
}: {
  message: DisplayMessage;
  pending?: PendingMessage;
  onRetry: (message: PendingMessage) => void;
}) {
  if (pending?.status === "sending") {
    return <span>Sending…</span>;
  }
  if (pending?.status === "failed") {
    return (
      <>
        <span className="text-destructive">Not delivered</span>
        <Button
          variant="link"
          size="xs"
          className="h-auto px-0"
          onClick={() => onRetry(pending)}
        >
          Retry
        </Button>
      </>
    );
  }
  return (
    <time
      dateTime={new Date(message.timestamp).toISOString()}
      className="font-mono text-[11px] tabular-nums"
    >
      {formatTime(message.timestamp)}
    </time>
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
