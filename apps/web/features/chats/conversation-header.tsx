"use client";

import type { CharacterSummary } from "@kazusa/client";
import { InfoIcon, MapPinIcon, SpeechIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useAccess } from "@/hooks/use-access";
import { useSelection } from "@/hooks/use-selection";
import { formatTypingLabel } from "@/lib/format";
import type { Typist } from "@/lib/live/realtime-state";
import { chatSubject, isOneOnOne, listNames } from "@/lib/source/chats/display";
import type { ChatInfo } from "@/lib/source/chats/types";
import { sameEntity, type EntityRef } from "@/lib/state/entity-ref";
import { taskIcon } from "@/lib/state/task-icon";
import { requestInspector } from "@/lib/state/ui-store";
import { formatSimDuration } from "@/lib/time/sim";
import { AvatarStack } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { CharacterAvatar } from "../characters/character-avatar";

const MAX_FACES = 3;

/**
 * Who a conversation is with and what they're up to. The faces open them (one
 * person) or the conversation's details (several), and Details shows its
 * subject, pressed while the panel already does. `tools` sit before Details:
 * how a talk is drawn, full screen and the like.
 */
export function ConversationHeader({
  chat,
  userId,
  typists,
  leading,
  tools,
  onTalkInPerson,
}: {
  chat: ChatInfo;
  userId: string;
  typists: readonly Typist[];
  /** Before the faces: a way back. */
  leading?: ReactNode;
  tools?: ReactNode;
  /** A DM partner standing where you are: talk face to face instead. */
  onTalkInPerson?: (id: string) => void;
}) {
  const { byId } = useCharacters();
  const [selection, select] = useSelection();
  const { canPlay } = useAccess();
  const place = usePlace(chat.placeId);
  const direct = isOneOnOne(chat, userId);
  const others = chat.members.filter((id) => id !== userId);
  const subject = chatSubject(chat, userId);
  const showing = subject !== null && sameEntity(subject, selection);
  const show = (ref: EntityRef | null) => {
    if (ref) void select(ref);
    requestInspector();
  };
  const faces = others
    .map((id) => byId.get(id))
    .filter((c): c is CharacterSummary => Boolean(c));
  const title = chat.type === "huddle" && place ? place.name : chat.name;

  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-ui-line ps-4 pe-2.5">
      {leading}
      {faces.length > 0 ? (
        <button
          type="button"
          aria-label={
            direct && faces[0] ? `About ${faces[0].name}` : `People in ${title}`
          }
          onClick={() =>
            show(
              direct && faces[0]
                ? { kind: "character", id: faces[0].id }
                : subject,
            )
          }
          // On a phone the names under the title say who's there.
          className={cx(
            "shrink-0 rounded-full transition-transform duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary active:scale-95",
            !direct && "max-sm:hidden",
          )}
        >
          <AvatarStack>
            {faces.slice(0, direct ? 1 : MAX_FACES).map((c) => (
              <CharacterAvatar
                key={c.id}
                id={c.id}
                name={c.name}
                avatarUrl={c.avatarUrl}
                kind={c.kind}
                size={direct ? "md" : "sm"}
                decorative
              />
            ))}
          </AvatarStack>
        </button>
      ) : chat.type === "huddle" ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-[0.875rem] bg-ui-tint text-ui-primary [&_svg]:size-5">
          <MapPinIcon aria-hidden />
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-[0.9375rem] leading-tight font-extrabold">
          {title}
        </h2>
        <ChatSubtitle chat={chat} userId={userId} typists={typists} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {tools}
        {direct && canPlay && others[0] && onTalkInPerson ? (
          <TalkInPerson id={others[0]} onTalk={onTalkInPerson} />
        ) : null}
        {subject ? (
          <IconButton
            label="Details"
            aria-pressed={showing}
            className={cx(showing && "bg-ui-tint text-ui-ink")}
            onClick={() => show(subject)}
          >
            <InfoIcon aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Who is typing or speaking now, else who is there, or what a DM's partner is
 * doing and for how long. Task text is shown as written, never parsed.
 */
export function ChatSubtitle({
  chat,
  userId,
  typists,
}: {
  chat: ChatInfo;
  userId: string;
  typists: readonly Typist[];
}) {
  const { byId } = useCharacters();
  const direct = isOneOnOne(chat, userId);
  const others = chat.members.filter((id) => id !== userId);
  const names = listNames(others.map((id) => byId.get(id)?.name ?? id));
  const className =
    "flex min-w-0 items-center gap-1 text-[0.8125rem] leading-tight text-ui-soft [&_svg]:size-3.5 [&_svg]:shrink-0";

  if (typists.length > 0) {
    const label = direct
      ? `${typists[0]?.mode ?? "typing"}`
      : formatTypingLabel(
          typists.map((t) => t.senderName),
          typists.every((t) => t.mode === "speaking") ? "speaking" : "typing",
        );
    return (
      <p
        key="typing"
        className={cx(
          className,
          "font-semibold text-ui-accent-ink motion-safe:animate-ui-fade-in",
        )}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="inline-flex gap-0.5 pt-1">
          {[
            "[animation-delay:0ms]",
            "[animation-delay:160ms]",
            "[animation-delay:320ms]",
          ].map((delay) => (
            <span
              key={delay}
              className={cx(
                "size-1 rounded-full bg-current motion-safe:animate-ui-dot",
                delay,
              )}
            />
          ))}
        </span>
      </p>
    );
  }
  if (chat.type === "huddle")
    return (
      <p className={className}>
        <SpeechIcon aria-hidden />
        <span className="truncate">
          {`${chat.ended ? "Was in person" : "In person"} · ${names || "just you"}`}
        </span>
      </p>
    );
  if (direct)
    return (
      <p className={className}>
        <Activity character={others[0] ? byId.get(others[0]) : undefined} />
      </p>
    );
  return (
    <p className={className}>
      <span className="truncate">
        {names || (chat.members.includes(userId) ? "Just you" : "No one here")}
      </span>
    </p>
  );
}

function Activity({ character }: { character: CharacterSummary | undefined }) {
  const status = useCharacterStatus(
    character?.kind === "agent" ? character.id : undefined,
  );
  const now = useSimNow();
  const task = status?.task;
  if (!task)
    return (
      <span className="truncate">{character?.summary ?? "Direct message"}</span>
    );
  const Icon = taskIcon(task.type);
  return (
    <>
      <Icon aria-hidden />
      <span className="truncate">{task.description}</span>
      {now > 0 && task.endAt > now ? (
        <span className="shrink-0 tabular-nums">{`· ${formatSimDuration(task.endAt - now)} left`}</span>
      ) : null}
    </>
  );
}

/** Only while they stand where you are. */
function TalkInPerson({
  id,
  onTalk,
}: {
  id: string;
  onTalk: (id: string) => void;
}) {
  const player = usePlayer();
  const position = usePosition(id);
  const together =
    position?.kind === "at" &&
    player.placeId !== undefined &&
    position.placeId === player.placeId;
  if (!together) return null;
  return (
    <IconButton label="Talk in person" onClick={() => onTalk(id)}>
      <SpeechIcon aria-hidden />
    </IconButton>
  );
}
