"use client";

import { forwardRef } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageContent,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { useCharacters } from "@/hooks/use-characters";
import { usePlace } from "@/hooks/use-location";
import { formatDateTime, initials } from "@/lib/format";
import { useSources } from "@/lib/source/provider";
import { isOneOnOne } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { cn } from "@/lib/utils";
import type { ChatMessage, WorldMeta } from "@kazusa/client";
import type { Participant } from "./chat-avatar";
import { ActionLine, buildRuns, StickerImage } from "./message-parts";

/** A phone's width: what a shared chat screenshot is expected to look like. */
export const CARD_WIDTH_PX = 400;

const NO_ACTIVITY = new Map<number, never>();
const NAMES = new Intl.ListFormat(undefined, {
  style: "long",
  type: "conjunction",
});
const noRetry = () => {};

/**
 * The picture a screenshot makes: the chosen messages laid out again at a
 * phone's width, whatever the screen they were chosen on. Read the way a chat
 * is: who is talking at the top, where the eye starts; then the conversation;
 * and where it ends, the credit, as a signature: the world, who made it, and
 * its link in the bottom-right corner, where a picture's source is looked for
 * and the eye leaves. Runs and names are worked out for these messages alone,
 * so the first one always says who is speaking. Plain `<img>`s, so every face
 * is loaded before the picture is taken.
 */
export const ScreenshotCard = forwardRef<
  HTMLDivElement,
  {
    chat: ChatInfo;
    messages: readonly ChatMessage[];
    userId: string;
    resolve: (id: string, fallbackName?: string) => Participant;
  }
>(function ScreenshotCard({ chat, messages, userId, resolve }, ref) {
  const { byId } = useCharacters();
  const { world } = useSources();
  const place = usePlace(chat.placeId);
  const isGroup = !isOneOnOne(chat, userId);
  const others = chat.members.filter((id) => id !== userId);
  // Everyone by name, never "+3": a count says nothing to whoever sees this.
  const names = NAMES.format(others.map((id) => byId.get(id)?.name ?? id));
  const runs = buildRuns([...messages], formatDateTime, NO_ACTIVITY);

  const title = chat.type === "huddle" && place ? place.name : chat.name;
  const subtitle =
    chat.type === "huddle"
      ? `In person with ${names || "nobody else"}`
      : isGroup
        ? names
        : undefined;
  const partner =
    !isGroup && others[0] ? resolve(others[0], chat.name) : undefined;

  return (
    <div
      ref={ref}
      style={{ width: CARD_WIDTH_PX }}
      className="flex flex-col bg-background font-sans text-foreground antialiased"
    >
      <header className="flex items-center gap-3 border-b px-5 py-4">
        {partner ? <Face participant={partner} size={40} /> : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-base leading-tight font-semibold">{title}</h1>
          {subtitle ? (
            <p className="text-xs leading-snug text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        {runs.map((run) => {
          const participant = resolve(run.senderId, run.senderName);
          const isSelf = run.senderId === userId;
          const align = isSelf ? "end" : "start";
          return (
            <div key={run.key} className="flex flex-col gap-4">
              {run.dayLabel ? (
                <Marker variant="separator" className="text-xs">
                  <MarkerContent>{run.dayLabel}</MarkerContent>
                </Marker>
              ) : null}
              {run.isAction ? (
                <div
                  className={
                    isSelf
                      ? "flex flex-col items-end gap-1 text-right"
                      : "flex flex-col gap-1 pl-10"
                  }
                >
                  {run.messages.map((message) => (
                    <ActionLine
                      key={message.id}
                      name={participant.name}
                      message={message}
                      onRetry={noRetry}
                    />
                  ))}
                </div>
              ) : (
                <MessageGroup className="gap-1">
                  {run.messages.map((message, index) => {
                    const isLast = index === run.messages.length - 1;
                    return (
                      <Message key={message.id} align={align}>
                        {isSelf ? null : isLast ? (
                          <Face
                            participant={participant}
                            size={32}
                            className="self-end"
                          />
                        ) : (
                          <div aria-hidden className="w-8 shrink-0" />
                        )}
                        <MessageContent className="gap-1">
                          {index === 0 &&
                          isGroup &&
                          !isSelf &&
                          !run.introduced ? (
                            <MessageHeader>{participant.name}</MessageHeader>
                          ) : null}
                          {message.type === "sticker" && message.sticker ? (
                            <StickerImage
                              url={message.sticker.url}
                              alt={message.text}
                              eager
                            />
                          ) : (
                            <Bubble
                              align={align}
                              variant={isSelf ? "default" : "secondary"}
                            >
                              <BubbleContent className="whitespace-pre-wrap">
                                {message.text}
                              </BubbleContent>
                            </Bubble>
                          )}
                        </MessageContent>
                      </Message>
                    );
                  })}
                </MessageGroup>
              )}
            </div>
          );
        })}
      </div>

      <Credit world={world} />
    </div>
  );
});

/** A face as a plain image, which the picture can wait on, or initials. */
function Face({
  participant,
  size,
  className,
}: {
  participant: Pick<Participant, "name" | "avatarUrl">;
  size: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {participant.avatarUrl ? (
        <img
          src={participant.avatarUrl}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
        />
      ) : (
        initials(participant.name)
      )}
    </span>
  );
}

/**
 * The world's credit at the picture's foot: its name and maker on the left, its
 * link on the right. Falls back to the world's title for a world without a
 * `package.json`, and to nothing without even that.
 */
function Credit({ world }: { world?: WorldMeta }) {
  const name = world?.package?.name ?? world?.title;
  if (!name) return null;
  const author = world?.package?.author;
  const link = world?.package?.homepage?.replace(/^https?:\/\//, "");
  return (
    <footer className="flex items-end justify-between gap-4 border-t px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs leading-snug font-medium">{name}</span>
        {author ? (
          <span className="text-[11px] leading-snug text-muted-foreground">
            {`by ${author}`}
          </span>
        ) : null}
      </div>
      {link ? (
        <span className="shrink-0 font-mono text-[11px] leading-snug text-muted-foreground">
          {link}
        </span>
      ) : null}
    </footer>
  );
}
