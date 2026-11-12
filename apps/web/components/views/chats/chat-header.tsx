"use client";

import { useQueryStates, parseAsString } from "nuqs";
import { chatsParsers } from "./search-params";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  InfoIcon,
  Maximize2Icon,
  SpeechIcon,
} from "lucide-react";
import type { CharacterSummary } from "@kazusa/client";
import { AddPeople } from "@/components/inspector/sections/chat-controls";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { taskIcon } from "@/components/entities/task-icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import { usePlace, usePlayer, usePosition } from "@/hooks/use-location";
import { useAccess } from "@/hooks/use-access";
import { useSelection } from "@/hooks/use-selection";
import { formatTypingLabel } from "@/lib/format";
import type { Typist } from "@/lib/live/realtime-state";
import { chatSubject, isOneOnOne, listNames } from "@/lib/source/chats/display";
import type { Chat, ChatInfo } from "@/lib/source/chats/types";
import { sameEntity, type EntityRef } from "@/lib/state/entity-ref";
import { requestInspector } from "@/lib/state/ui-store";
import { formatSimDuration } from "@/lib/time/sim";
import { cn } from "@/lib/utils";
import {
  READING_HINT,
  type ReadingToggleProps,
} from "./scene/fullscreen-controls";
import { SceneSwitch } from "./scene/scene-switch";
import type { ChatRenderingState } from "./scene/use-chat-rendering";

const MAX_FACES = 4;

/**
 * Who you are talking with and what they are up to, at the top of a chat. The
 * title is plain text; what can be clicked says where it goes: a DM's avatar
 * and each member's face open that person, the place opens the place, and
 * Details shows the whole chat (pressed while the inspector already does).
 * `own` is the player's own sent chat, for its one contextual action: Add
 * people to a group, call people over in person, or talk in person with the
 * partner of a DM standing where you are. `rendering` adds Scene | Transcript
 * for a huddle that can be drawn.
 */
export function ChatHeader({
  chat,
  own,
  userId,
  typists,
  onBack,
  rendering,
  onFullscreen,
  reading,
}: {
  chat: ChatInfo;
  own?: Chat;
  userId: string;
  typists: readonly Typist[];
  onBack: () => void;
  rendering?: ChatRenderingState;
  /** Shows the scene full screen; given only while the scene is showing. */
  onFullscreen?: () => void;
  /** Reading mode; given only while the scene shows, to a clock manager. */
  reading?: ReadingToggleProps;
}) {
  const { canPlay } = useAccess();
  const { byId } = useCharacters();
  const [selection, select] = useSelection();
  const place = usePlace(chat.placeId);
  const isDirect = isOneOnOne(chat, userId);
  const others = chat.members.filter((id) => id !== userId);
  const partnerId = isDirect ? others[0] : undefined;
  const partner = partnerId ? byId.get(partnerId) : undefined;

  const subject = chatSubject(chat, userId);
  const showing = subject !== null && sameEntity(subject, selection);
  const show = (ref: EntityRef | null) => {
    if (ref) void select(ref);
    requestInspector();
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onBack}
      >
        <ChevronLeftIcon />
        <span className="sr-only">Back to chats</span>
      </Button>

      {partnerId ? (
        <button
          type="button"
          onClick={() => show({ kind: "character", id: partnerId })}
          className="shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <PresenceAvatar
            id={partnerId}
            name={partner?.name ?? chat.name}
            avatarUrl={partner?.avatarUrl}
            kind={partner?.kind}
            size="md"
          />
          <span className="sr-only">{`About ${partner?.name ?? chat.name}`}</span>
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-sm leading-tight font-semibold">
          {chat.type === "huddle" && place ? (
            // Just the place: "In person" below says it's a conversation, and
            // a narrow header would cut "Talking at …" before the place.
            <button
              type="button"
              title={place.summary}
              onClick={() => show({ kind: "place", id: place.id })}
              className="max-w-full truncate rounded-sm text-left underline decoration-muted-foreground/40 underline-offset-2 outline-none hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {place.name}
            </button>
          ) : (
            chat.name
          )}
        </h2>
        <ChatSubtitle chat={chat} userId={userId} typists={typists} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* What only the scene has comes first, so Scene | Transcript stays
            where it is when the rendering changes. */}
        {reading ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={reading.on}
                  className={cn(reading.on && "bg-muted text-foreground")}
                  onClick={(event) => {
                    // Turning it on leaves focus on the page, so Space advances
                    // the scene instead of pressing this button again.
                    if (!reading.on) event.currentTarget.blur();
                    reading.onToggle();
                  }}
                />
              }
            >
              <BookOpenIcon />
              <span className="sr-only">Reading mode</span>
            </TooltipTrigger>
            <TooltipContent>{READING_HINT}</TooltipContent>
          </Tooltip>
        ) : null}
        {onFullscreen ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={onFullscreen} />
              }
            >
              <Maximize2Icon />
              <span className="sr-only">Full screen</span>
            </TooltipTrigger>
            <TooltipContent>Full screen</TooltipContent>
          </Tooltip>
        ) : null}
        {rendering?.canScene ? (
          <SceneSwitch as={rendering.as} onChange={rendering.setAs} />
        ) : null}
        {!isDirect && others.length > 0 ? (
          <Faces
            ids={others}
            chat={chat}
            onPick={(id) => show({ kind: "character", id })}
            onMore={() => show(subject)}
          />
        ) : null}
        {own && canPlay && (own.type === "group" || own.type === "huddle") ? (
          <AddPeople chat={own} placeName={place?.name} compact />
        ) : null}
        {own && partnerId && canPlay ? <TalkInPerson id={partnerId} /> : null}
        {subject ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={showing}
                  className={cn(showing && "bg-muted text-foreground")}
                  onClick={() => show(subject)}
                />
              }
            >
              <InfoIcon />
              <span className="sr-only">Details</span>
            </TooltipTrigger>
            <TooltipContent>Details</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}

/**
 * The line under a chat's name: who is typing or speaking right now, else who
 * is there (in person, a group) or what a DM's partner is doing and for how
 * long. Shared with the screenshot's header, which passes no typists.
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
  const isDirect = isOneOnOne(chat, userId);
  const others = chat.members.filter((id) => id !== userId);
  const partner = isDirect && others[0] ? byId.get(others[0]) : undefined;
  const typing = typists.length > 0;
  return (
    <p
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs leading-tight text-muted-foreground",
        typing && "shimmer text-primary",
      )}
    >
      {typing ? (
        <span className="truncate">
          {isDirect
            ? `${typists[0].mode}…`
            : formatTypingLabel(
                typists.map((t) => t.senderName),
                typists.every((t) => t.mode === "speaking")
                  ? "speaking"
                  : "typing",
              )}
        </span>
      ) : chat.type === "huddle" ? (
        <>
          <SpeechIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">
            {`${chat.ended ? "Was in person" : "In person"} · ${
              listNames(others.map((id) => byId.get(id)?.name ?? id)) ||
              "just you"
            }`}
          </span>
        </>
      ) : isDirect ? (
        <Activity character={partner} />
      ) : (
        <span className="truncate">
          {listNames(others.map((id) => byId.get(id)?.name ?? id)) ||
            "Just you"}
        </span>
      )}
    </p>
  );
}

/**
 * Everyone else in a group or huddle as faces with their presence rings, so who
 * is thinking or typing shows at a glance; each opens that person. Hidden on
 * narrow screens, where the subtitle's names say who is there.
 */
function Faces({
  ids,
  chat,
  onPick,
  onMore,
}: {
  ids: readonly string[];
  chat: Pick<Chat, "id" | "type">;
  onPick: (id: string) => void;
  onMore: () => void;
}) {
  const shown = ids.slice(0, MAX_FACES);
  const rest = ids.length - shown.length;
  return (
    <div className="mr-1 hidden items-center sm:flex">
      {shown.map((id, index) => (
        <Face
          key={id}
          id={id}
          chat={chat}
          first={index === 0}
          onPick={onPick}
        />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          onClick={onMore}
          className="-ml-1.5 flex size-7 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground tabular-nums ring-2 ring-background outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {`+${rest}`}
          <span className="sr-only">{`and ${rest} more: details`}</span>
        </button>
      ) : null}
    </div>
  );
}

function Face({
  id,
  chat,
  first,
  onPick,
}: {
  id: string;
  chat: Pick<Chat, "id" | "type">;
  first: boolean;
  onPick: (id: string) => void;
}) {
  const { byId } = useCharacters();
  const character = byId.get(id);
  const status = useCharacterStatus(
    character?.kind === "agent" ? id : undefined,
  );
  const name = character?.name ?? id;
  // Saying a line here is speaking; anything else composed is typed.
  const doing = status?.composingIn.includes(chat.id)
    ? chat.type === "huddle"
      ? "Speaking"
      : "Typing"
    : status?.composingIn.length
      ? "Typing"
      : status?.brain === "thinking"
        ? "Thinking"
        : status?.task?.description;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => onPick(id)}
            className={cn(
              "relative rounded-full outline-none hover:z-10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              !first && "-ml-1.5",
            )}
          />
        }
      >
        <PresenceAvatar
          id={id}
          name={name}
          avatarUrl={character?.avatarUrl}
          kind={character?.kind}
          size="sm"
          className="ring-2 ring-background"
        />
        <span className="sr-only">{`About ${name}`}</span>
      </TooltipTrigger>
      <TooltipContent className="flex max-w-56 flex-col">
        <span className="font-medium">{name}</span>
        {doing ? (
          <span className="line-clamp-2 opacity-80">{doing}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** In a DM with someone standing where you are: talk face to face instead. */
function TalkInPerson({ id }: { id: string }) {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "chats.talk": chatsParsers["chats.talk"],
  });
  const player = usePlayer();
  const position = usePosition(id);
  const together =
    position?.kind === "at" &&
    player.placeId !== undefined &&
    position.placeId === player.placeId;
  if (!together) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void setParams({ view: "chats", "chats.talk": id })}
          />
        }
      >
        <SpeechIcon />
        <span className="sr-only">Talk in person</span>
      </TooltipTrigger>
      <TooltipContent>Talk in person</TooltipContent>
    </Tooltip>
  );
}

/**
 * What a reply that hasn't come yet is waiting on: "Reading · 34m left". Task
 * text is shown verbatim, never parsed (D7).
 */
function Activity({ character }: { character: CharacterSummary | undefined }) {
  const status = useCharacterStatus(
    character?.kind === "agent" ? character.id : undefined,
  );
  const now = useSimNow();
  const task = status?.task;
  if (!task) {
    return (
      <span className="truncate">
        {character?.occupation ?? "Direct message"}
      </span>
    );
  }
  const Icon = taskIcon(task.type);
  return (
    <>
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{task.description}</span>
      {now > 0 && task.endAt > now ? (
        <span className="shrink-0 font-mono tabular-nums">{`· ${formatSimDuration(task.endAt - now)} left`}</span>
      ) : null}
    </>
  );
}
