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
import { formatDayLabel, formatTime, isSameDay } from "@/lib/format";
import type { ChatMessage } from "@kazusa/client";
import type { Chat, PendingMessage } from "@/lib/source/chats/types";
import { ParticipantAvatar, type Participant } from "./chat-avatar";
import type { Typist } from "@/lib/live/realtime-provider";

const RUN_GAP_MS = 5 * 60 * 1000;

type DisplayMessage = (ChatMessage & { status?: never }) | PendingMessage;

type Run = {
  key: string;
  senderId: string;
  senderName: string;
  messages: DisplayMessage[];
  dayLabel: string | null;
};

function buildRuns(messages: DisplayMessage[], simNow: number) {
  const runs: Run[] = [];
  let previous: DisplayMessage | null = null;

  for (const message of messages) {
    const newDay =
      !previous || !isSameDay(previous.timestamp, message.timestamp);
    const current = runs[runs.length - 1];
    const continues =
      current &&
      !newDay &&
      previous &&
      previous.senderId === message.senderId &&
      message.timestamp - previous.timestamp < RUN_GAP_MS &&
      !previous.status === !message.status;

    if (continues) {
      current.messages.push(message);
    } else {
      runs.push({
        key: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        messages: [message],
        dayLabel: newDay ? formatDayLabel(message.timestamp, simNow) : null,
      });
    }
    previous = message;
  }
  return runs;
}

export function MessageList({
  chat,
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
}: {
  chat: Chat;
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
}) {
  const simNow = useSimNow();
  const isGroup = chat.type === "group";
  const runs = buildRuns([...messages, ...pending], simNow);
  const pendingById = new Map(pending.map((message) => [message.id, message]));

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-4 px-4 pt-6 pb-4">
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
                    <EmptyTitle>
                      {isGroup
                        ? `Welcome to ${chat.name}`
                        : `Say hello to ${chat.name}`}
                    </EmptyTitle>
                    <EmptyDescription>
                      {isGroup
                        ? "Every agent in this group will see your message and can reply."
                        : "Messages here are private between you and this agent."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            ) : null}

            {runs.map((run) => {
              const participant = resolve(run.senderId, run.senderName);
              const isSelf = run.senderId === userId;
              const align = isSelf ? "end" : "start";

              return (
                <Fragment key={run.key}>
                  {run.dayLabel ? (
                    <MessageScrollerItem messageId={`day-${run.key}`}>
                      <Marker variant="separator" className="text-xs">
                        <MarkerContent>{run.dayLabel}</MarkerContent>
                      </Marker>
                    </MessageScrollerItem>
                  ) : null}
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
                              {isFirst && isGroup && !isSelf ? (
                                <MessageHeader>
                                  {participant.name}
                                </MessageHeader>
                              ) : null}
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
                </Fragment>
              );
            })}

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
                            {`${isGroup ? "Typing" : `${participant.name} is typing`}…`}
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
