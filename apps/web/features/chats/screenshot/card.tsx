"use client";

import type { ChatMessage, WorldMeta } from "@kazusa/client";
import type { Ref } from "react";
import { usePlace } from "@/hooks/use-location";
import { formatDateTime, initials } from "@/lib/format";
import { actionLine, isOneOnOne } from "@/lib/source/chats/display";
import { buildRuns } from "@/lib/source/chats/runs";
import type { ChatInfo } from "@/lib/source/chats/types";
import { useSources } from "@/lib/source/provider";
import {
  Bubble,
  DayMark,
  MessageRun,
  Narration,
  type RunPosition,
  Sticker,
} from "@/ui/message";
import { ChatSubtitle } from "../conversation-header";

/** A phone's width: what a shared chat screenshot is expected to look like. */
export const CARD_WIDTH_PX = 400;

const NO_ACTIVITY = new Map<number, never>();
const NO_TYPISTS: never[] = [];

type Resolve = (
  id: string,
  fallbackName?: string,
) => { name: string; avatarUrl?: string };

function positionOf(index: number, count: number): RunPosition {
  if (count === 1) return "single";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/**
 * The picture a screenshot makes: the chosen messages laid out again at a
 * phone's width, whatever the screen they were chosen on. The chat's own title
 * bar where the eye starts, then the conversation, then the world's credit as a
 * signature where the eye leaves. Runs and names are worked out for these
 * messages alone, so the first one always says who is speaking. Plain `<img>`s,
 * so every face has loaded before the picture is taken.
 */
export function ScreenshotCard({
  ref,
  chat,
  messages,
  userId,
  resolve,
}: {
  ref?: Ref<HTMLDivElement>;
  chat: ChatInfo;
  messages: readonly ChatMessage[];
  userId: string;
  resolve: Resolve;
}) {
  const { world } = useSources();
  const place = usePlace(chat.placeId);
  const group = !isOneOnOne(chat, userId);
  const others = chat.members.filter((id) => id !== userId);
  const runs = buildRuns([...messages], formatDateTime, NO_ACTIVITY);
  const title = chat.type === "huddle" && place ? place.name : chat.name;
  const partner =
    !group && others[0] ? resolve(others[0], chat.name) : undefined;

  return (
    <div
      ref={ref}
      style={{ width: CARD_WIDTH_PX }}
      className="flex flex-col bg-ui-surface text-ui-ink antialiased"
    >
      <header className="flex items-center gap-3 border-b border-ui-line px-5 py-4">
        {partner ? <Face person={partner} size={40} /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-base leading-tight font-extrabold">
            {title}
          </h1>
          <ChatSubtitle chat={chat} userId={userId} typists={NO_TYPISTS} />
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-5 pb-6">
        {runs.map((run) => {
          const sender = resolve(run.senderId, run.senderName);
          const mine = run.senderId === userId;
          const side = mine ? "end" : "start";
          return (
            <div key={run.key} className="flex flex-col gap-3">
              {run.dayLabel ? <DayMark>{run.dayLabel}</DayMark> : null}
              <MessageRun
                side={side}
                face={
                  mine || run.isAction ? undefined : (
                    <Face person={sender} size={32} />
                  )
                }
                name={
                  group && !mine && !run.isAction && !run.introduced
                    ? sender.name
                    : undefined
                }
              >
                {run.messages.map((message, index) => {
                  if (run.isAction) {
                    const line = actionLine(sender.name, message.text);
                    return (
                      <Narration
                        key={message.id}
                        side={side}
                        subject={line.subject}
                        rest={line.rest}
                      />
                    );
                  }
                  if (message.type === "sticker" && message.sticker)
                    return (
                      <Sticker
                        key={message.id}
                        side={side}
                        src={message.sticker.url}
                        alt={message.text}
                        eager
                      />
                    );
                  return (
                    <Bubble
                      key={message.id}
                      side={side}
                      tone={mine ? "mine" : "theirs"}
                      position={positionOf(index, run.messages.length)}
                    >
                      {message.text}
                    </Bubble>
                  );
                })}
              </MessageRun>
            </div>
          );
        })}
      </div>

      <Credit world={world} />
    </div>
  );
}

/** A face as a plain image, which the picture can wait on, or initials. */
function Face({
  person,
  size,
}: {
  person: { name: string; avatarUrl?: string };
  size: number;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-ui-tint text-xs font-extrabold text-ui-primary"
    >
      {person.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
        />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

/**
 * The world's credit at the picture's foot: its name and maker on the left, its
 * link on the right. The world's title without a `package.json`, and nothing
 * without even that.
 */
function Credit({ world }: { world?: WorldMeta }) {
  const name = world?.package?.name ?? world?.title;
  if (!name) return null;
  const author = world?.package?.author;
  const link = world?.package?.homepage?.replace(/^https?:\/\//, "");
  return (
    <footer className="flex items-end justify-between gap-4 border-t border-ui-line px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs leading-snug font-bold">{name}</span>
        {author ? (
          <span className="text-[0.6875rem] leading-snug text-ui-soft">
            {`by ${author}`}
          </span>
        ) : null}
      </div>
      {link ? (
        <span className="shrink-0 text-[0.6875rem] leading-snug text-ui-soft">
          {link}
        </span>
      ) : null}
    </footer>
  );
}
