"use client";

import type { JournalEvent } from "@kazusa/client";
import {
  BanIcon,
  ClockIcon,
  EyeIcon,
  MessageSquareDashedIcon,
  MessageSquareTextIcon,
  MoonIcon,
  PencilLineIcon,
  TimerResetIcon,
  UserCogIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Fragment, memo, type ReactNode } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useSources } from "@/lib/source/provider";
import { taskIcon, taskLabel } from "@/lib/state/task-icon";
import { TaskChip } from "../entities/task-chip";
import {
  formatSimDuration,
  formatSimTime,
  formatSpeed,
  MINUTE,
} from "@/lib/time/sim";
import { AvatarStack } from "@/ui/avatar";
import { ClampText } from "@/ui/clamp-text";
import {
  ChronicleEntry,
  ChronicleMilestone,
  ChronicleMore,
  ChronicleThought,
  type ChronicleTone,
  type ChronicleVariant,
} from "@/ui/timeline";
import { Tooltip } from "@/ui/tooltip";
import { CharacterAvatar } from "../characters/character-avatar";
import { CharacterChip, ChatChip, PlaceChip } from "../entities/chips";
import { OpenConversationButton, WikiPageChip } from "./chips";

const MAX_ACTORS = 3;

const NOTICED_LEAD = {
  arrive: "walked in on",
  comes: "saw",
  cross: "crossed paths with",
  meet: "passed",
} as const;

const NOTICED_WHERE = {
  arrive: "at",
  comes: "at",
  cross: "at",
  meet: "between",
} as const;

function ActorList({
  actors,
  showAvatar = true,
}: {
  actors: readonly string[];
  showAvatar?: boolean;
}) {
  if (actors.length === 0) return null;
  return (
    <>
      {actors.slice(0, MAX_ACTORS).map((id, index) => (
        <Fragment key={id}>
          {index > 0 ? ", " : null}
          <CharacterChip id={id} showAvatar={showAvatar && index === 0} />
        </Fragment>
      ))}
      {actors.length > MAX_ACTORS ? (
        <span className="ms-1 text-xs font-bold text-ui-soft tabular-nums">
          {`+${actors.length - MAX_ACTORS}`}
        </span>
      ) : null}
    </>
  );
}

const NOTE_CLASS = "text-[0.8125rem] leading-normal text-pretty text-ui-soft";

/**
 * Formats a `message.sent` preview cleanly: detects `*action*` lines for
 * italics without literal asterisks, and trims backend 100-char mid-word cuts
 * at a word boundary with an ellipsis.
 */
function formatMessagePreview(raw: string): {
  readonly text: string;
  readonly isAction: boolean;
} {
  const trimmed = raw.trim();
  const isAction = trimmed.startsWith("*");
  let text = isAction
    ? trimmed.replace(/^\*+/, "").replace(/\*+$/, "").trim()
    : trimmed;
  if (raw.length >= 100 && !/[.!?…]$/.test(text)) {
    const clean = text.replace(/[,;:\s]+\S*$/, "");
    text = `${clean || text}…`;
  }
  return { text, isAction };
}

function PreviewLine({ preview }: { preview: string }) {
  const { text, isAction } = formatMessagePreview(preview);
  return (
    <span className={isAction ? "text-ui-soft italic" : "text-ui-soft"}>
      {text}
    </span>
  );
}

function WhoseList({ senders }: { senders: readonly string[] }) {
  return (
    <>
      {senders.map((id, index) => (
        <Fragment key={id}>
          {index > 0 ? (index === senders.length - 1 ? " and " : ", ") : null}
          <CharacterChip id={id} showAvatar={false} />
          {"'s"}
        </Fragment>
      ))}
    </>
  );
}

function AttentionSummary({
  payload,
  actor,
}: {
  payload: Extract<JournalEvent, { kind: "attention.decided" }>["payload"];
  /** Whose attention: their activity's chip opens their Timeline. */
  actor: string | undefined;
}) {
  const { outcome, lines, tunedOut } = payload;
  const activity =
    outcome === "deferred" && lines.length ? undefined : payload.activity;

  const senders = [...new Set(lines.map((line) => line.sender))];
  const chats = new Set(lines.map((line) => line.chatId));
  const spoken = lines.filter((line) => line.chatId.startsWith("huddle:"));
  const inPerson = spoken.length === lines.length;
  const group = chats.size === 1 && lines[0]?.chatId.startsWith("group:");
  const count = lines.reduce((sum, line) => sum + (line.count ?? 1), 0);
  const what =
    count === 1
      ? inPerson
        ? "words"
        : "text"
      : `${count} ${inPerson ? "lines" : spoken.length ? "messages" : "texts"}`;

  const passed =
    outcome && lines.length > 0 ? (
      <>
        {outcome === "ignored"
          ? inPerson
            ? "didn't catch "
            : "left "
          : "set "}
        {senders.length <= 2 ? (
          <>
            <WhoseList senders={senders} />{" "}
          </>
        ) : null}
        {what}
        {group ? (
          <>
            {" in "}
            <ChatChip id={lines[0].chatId} />
          </>
        ) : null}
        {outcome === "ignored" ? (
          inPerson ? (
            ""
          ) : (
            " unread"
          )
        ) : activity ? (
          <>
            {" aside until "}
            <TaskChip type={activity.type} actor={actor} />
            {` ends (${formatSimTime(activity.endAt)})`}
          </>
        ) : (
          " aside for later"
        )}
      </>
    ) : null;

  return (
    <>
      {passed}
      {tunedOut ? (
        <>
          {lines.length ? "; stopped following " : "stopped following "}
          <ChatChip id={tunedOut} />
        </>
      ) : null}
      {activity ? (
        <span className="text-ui-soft">
          {" · while "}
          <TaskChip type={activity.type} actor={actor} />
        </span>
      ) : null}
    </>
  );
}

export const EventRow = memo(function EventRow({
  event,
  enter = false,
  live = false,
}: {
  event: JournalEvent;
  enter?: boolean;
  live?: boolean;
}) {
  const { player } = useSources();
  const time = formatSimTime(event.simTime);
  const dateTime = new Date(event.simTime).toISOString();
  const key = String(event.seq);
  const playerInvolved =
    Boolean(player.id) &&
    (event.actors.includes(player.id) ||
      (event.kind === "location.noticed" &&
        event.payload.subjects.includes(player.id)));

  if (event.kind === "clock.changed") {
    const label =
      event.payload.advancedMinutes !== undefined
        ? `Clock advanced ${formatSimDuration(event.payload.advancedMinutes * MINUTE)}`
        : event.payload.speed === 0
          ? "Simulation paused"
          : `Speed set to ${formatSpeed(event.payload.speed ?? 0)}`;
    return (
      <ChronicleMilestone
        value={key}
        time={time}
        dateTime={dateTime}
        icon={<ClockIcon aria-hidden />}
        label={label}
        enter={enter}
      />
    );
  }

  let icon: ReactNode;
  let tone: ChronicleTone = playerInvolved ? "accent" : "neutral";
  let variant: ChronicleVariant = "quiet";
  let actors: readonly string[] = event.actors;
  let title: ReactNode;
  let meta: ReactNode = null;
  let description: ReactNode = null;
  let trailing: ReactNode = null;

  switch (event.kind) {
    case "task.started": {
      const Icon = taskIcon(event.payload.type);
      icon = <Icon aria-hidden />;
      const {
        type,
        description: taskDesc,
        duration,
        where,
        from,
        spot,
        unknown,
        monologue,
      } = event.payload;
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <ActorList actors={actors} />
          <TaskChip type={type} actor={actors[0]} capital />
          {spot ? <span className="text-ui-soft">{`(${spot})`}</span> : null}
          {unknown ? (
            <span className="text-ui-soft">{`toward ${unknown}`}</span>
          ) : null}
        </span>
      );
      meta = (
        <span className="inline-flex items-center gap-1.5">
          {from && where ? (
            <>
              <PlaceChip id={from} quiet />
              <span aria-hidden="true">→</span>
              <PlaceChip id={where} bare quiet />
            </>
          ) : where ? (
            <PlaceChip id={where} quiet />
          ) : null}
          <Tooltip label="Estimated time left">
            <span
              tabIndex={0}
              aria-label={formatSimDuration(duration * MINUTE)}
              className="cursor-help rounded-[0.375rem] px-1 outline-none hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary"
            >
              {formatSimDuration(duration * MINUTE)}
            </span>
          </Tooltip>
        </span>
      );
      if (taskDesc || monologue) {
        description = (
          <>
            {taskDesc ? (
              <ClampText lines={1} className={NOTE_CLASS}>
                {taskDesc}
              </ClampText>
            ) : null}
            {monologue ? (
              <ChronicleThought>{monologue}</ChronicleThought>
            ) : null}
          </>
        );
      }
      break;
    }

    case "task.delayed": {
      icon = <TimerResetIcon aria-hidden />;
      const text = [event.payload.reason, event.payload.monologue]
        .filter(Boolean)
        .join(" ");
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <span className="text-ui-soft">stayed longer</span>
        </span>
      );
      meta = `+${formatSimDuration(Math.max(0, event.payload.endAt - event.simTime))}`;
      if (text) {
        description = <ChronicleThought>{text}</ChronicleThought>;
      }
      break;
    }

    case "task.stopped": {
      icon = <BanIcon aria-hidden />;
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <span className="text-ui-soft">stopped</span>
          <TaskChip type={event.payload.type} actor={actors[0]} />
        </span>
      );
      if (event.payload.description) {
        description = (
          <ClampText lines={1} className={NOTE_CLASS}>
            {event.payload.description}
          </ClampText>
        );
      }
      break;
    }

    case "message.sent": {
      icon = <MessageSquareTextIcon aria-hidden />;
      actors = [event.payload.senderId];
      const { text, isAction } = formatMessagePreview(event.payload.preview);
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <span className="text-ui-soft">in</span>
          {event.chatId ? <ChatChip id={event.chatId} /> : "a chat"}
        </span>
      );
      description = isAction ? (
        <p className="text-[0.8125rem] leading-normal text-pretty text-ui-soft italic">
          {text}
        </p>
      ) : (
        <ClampText lines={1} className={NOTE_CLASS}>
          {text}
        </ClampText>
      );
      if (event.chatId) {
        trailing = (
          <OpenConversationButton
            chatId={event.chatId}
            messageId={event.payload.messageId}
          />
        );
      }
      break;
    }

    case "chat.created": {
      icon = <UsersRoundIcon aria-hidden />;
      variant = "card";
      if (!playerInvolved) tone = "primary";
      actors = event.actors.slice(0, 1);
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          {event.payload.type === "huddle" ? (
            <>
              <span>started talking with</span>
              <ActorList
                actors={event.payload.members.filter(
                  (id) => id !== event.actors[0],
                )}
                showAvatar={false}
              />
            </>
          ) : (
            <>
              <span>
                {`started ${event.payload.type === "group" ? "group" : "chat"}`}
              </span>
              <span className="font-bold">{event.payload.title}</span>
            </>
          )}
        </span>
      );
      if (event.chatId) {
        trailing = <OpenConversationButton chatId={event.chatId} />;
      }
      break;
    }

    case "chat.renamed": {
      icon = <PencilLineIcon aria-hidden />;
      actors = event.actors.slice(0, 1);
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <span className="text-ui-soft">renamed</span>
          {event.chatId ? <ChatChip id={event.chatId} /> : "a chat"}
          <span className="text-ui-soft">to</span>
          <span className="font-semibold">{event.payload.title}</span>
        </span>
      );
      if (event.chatId) {
        trailing = <OpenConversationButton chatId={event.chatId} />;
      }
      break;
    }

    case "chat.members_changed": {
      icon = <UserCogIcon aria-hidden />;
      actors = event.actors.slice(0, 1);
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          {event.payload.added.length ? (
            <>
              <span className="text-ui-soft">added</span>
              <ActorList actors={event.payload.added} showAvatar={false} />
            </>
          ) : null}
          {event.payload.removed.length ? (
            <>
              <span className="text-ui-soft">removed</span>
              <ActorList actors={event.payload.removed} showAvatar={false} />
            </>
          ) : null}
          {event.chatId ? (
            <>
              <span className="text-ui-soft">in</span>
              <ChatChip id={event.chatId} />
            </>
          ) : null}
        </span>
      );
      if (event.chatId) {
        trailing = <OpenConversationButton chatId={event.chatId} />;
      }
      break;
    }

    case "attention.decided": {
      icon = <MessageSquareDashedIcon aria-hidden />;
      const [first] = event.payload.lines;
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <AttentionSummary payload={event.payload} actor={actors[0]} />
        </span>
      );
      if (event.payload.lines.length === 1) {
        description = (
          <ClampText lines={1} className={NOTE_CLASS}>
            {`“${event.payload.lines[0].excerpt}”`}
          </ClampText>
        );
      } else if (event.payload.lines.length > 1) {
        description = (
          <ChronicleMore summary={`${event.payload.lines.length} excerpts`}>
            {event.payload.lines.map((line) => (
              <p key={line.messageId} className="min-w-0 text-pretty">
                <CharacterChip
                  id={line.sender}
                  showAvatar={false}
                  className="-ms-1 me-1 align-baseline"
                />
                <PreviewLine preview={line.excerpt} />
              </p>
            ))}
          </ChronicleMore>
        );
      }
      if (event.chatId) {
        trailing = (
          <OpenConversationButton
            chatId={event.chatId}
            messageId={
              first?.chatId === event.chatId ? first.messageId : undefined
            }
          />
        );
      }
      break;
    }

    case "location.noticed": {
      icon = <EyeIcon aria-hidden />;
      tone = "accent";
      variant = "card";
      const {
        subjects,
        placeId,
        moment,
        between,
        huddle,
        word,
        probability,
        roll,
      } = event.payload;
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <span>{NOTICED_LEAD[moment]}</span>
          <ActorList actors={subjects} showAvatar={false} />
          <span>{NOTICED_WHERE[moment]}</span>
          <PlaceChip id={placeId} />
          {between ? (
            <>
              <span>and</span>
              <PlaceChip id={between} />
            </>
          ) : null}
        </span>
      );
      description = (
        <ChronicleMore summary="Encounter roll">
          <span>
            {`${word} · ${Math.round(probability * 100)}% chance (roll ${roll.toFixed(2)})`}
          </span>
        </ChronicleMore>
      );
      if (huddle) {
        trailing = <OpenConversationButton chatId={huddle} />;
      }
      break;
    }

    case "memory.consolidated": {
      icon = <MoonIcon aria-hidden />;
      tone = "accent";
      variant = "card";
      const { pages, newPages, dream } = event.payload;
      const newSet = new Set(newPages);
      title = (
        <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          <ActorList actors={actors} />
          <span>{dream ? "dreamed overnight" : "slept on the day"}</span>
        </span>
      );
      if (dream || pages.length > 0) {
        description = (
          <>
            {dream ? <ChronicleThought>{dream}</ChronicleThought> : null}
            {pages.length > 0 ? (
              <ChronicleMore summary="Memories updated">
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {pages.map((pageId) => (
                    <WikiPageChip
                      key={pageId}
                      id={pageId}
                      isNew={newSet.has(pageId)}
                    />
                  ))}
                </div>
              </ChronicleMore>
            ) : null}
          </>
        );
      }
      break;
    }

    default: {
      const exhaustive: never = event;
      void exhaustive;
      return null;
    }
  }

  return (
    <ChronicleEntry
      value={key}
      time={time}
      dateTime={dateTime}
      icon={icon}
      tone={tone}
      variant={variant}
      live={live}
      enter={enter}
      title={title}
      meta={meta}
      description={description}
      trailing={trailing}
    />
  );
});

export const BurstRow = memo(function BurstRow({
  category,
  label,
  chatId,
  events,
  enter = false,
}: {
  category: "task" | "message";
  label: string;
  chatId?: string;
  events: readonly JournalEvent[];
  enter?: boolean;
}) {
  const { byId } = useCharacters();
  const newest = events[0];
  const time = formatSimTime(newest.simTime);
  const dateTime = new Date(newest.simTime).toISOString();

  const uniqueActorIds = [
    ...new Set(
      events.flatMap((event) =>
        event.kind === "message.sent" ? [event.payload.senderId] : event.actors,
      ),
    ),
  ];

  const avatars = (
    <AvatarStack size="xs">
      {uniqueActorIds.slice(0, 3).map((id) => {
        const c = byId.get(id);
        return (
          <CharacterAvatar
            key={id}
            id={id}
            name={c?.name ?? id}
            avatarUrl={c?.avatarUrl}
            kind={c?.kind}
            size="xs"
            decorative
          />
        );
      })}
    </AvatarStack>
  );

  if (category === "message" && chatId) {
    return (
      <ChronicleEntry
        value={`burst-${newest.seq}`}
        time={time}
        dateTime={dateTime}
        icon={<MessageSquareTextIcon aria-hidden />}
        variant="quiet"
        enter={enter}
        title={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {avatars}
            <ChatChip id={chatId} />
          </span>
        }
        trailing={<OpenConversationButton chatId={chatId} />}
        description={
          <ChronicleMore summary="Show conversation">
            {events.map((event) =>
              event.kind === "message.sent" ? (
                <div key={event.seq} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {formatSimTime(event.simTime)}
                  </span>
                  <p className="min-w-0 flex-1 text-pretty">
                    <CharacterChip
                      id={event.payload.senderId}
                      showAvatar={false}
                      className="-ms-1 me-1 align-baseline"
                    />
                    <PreviewLine preview={event.payload.preview} />
                  </p>
                </div>
              ) : null,
            )}
          </ChronicleMore>
        }
      />
    );
  }

  const Icon = taskIcon(label);
  const activity = taskLabel(label).toLowerCase();

  return (
    <ChronicleEntry
      value={`burst-${newest.seq}`}
      time={time}
      dateTime={dateTime}
      icon={<Icon aria-hidden />}
      variant="quiet"
      enter={enter}
      title={
        <span className="inline-flex flex-wrap items-center gap-1.5 text-ui-soft">
          {avatars}
          {uniqueActorIds.length === 1 ? (
            <>
              <CharacterChip id={uniqueActorIds[0]} showAvatar={false} />
              <span>{`spent time ${activity}`}</span>
            </>
          ) : (
            <span>{`Several people ${activity}`}</span>
          )}
        </span>
      }
      description={
        <ChronicleMore summary={`Show ${activity} notes`}>
          {events.map((event) =>
            event.kind === "task.started" ? (
              <div key={event.seq} className="flex items-baseline gap-2">
                <span className="shrink-0 text-xs font-semibold tabular-nums">
                  {formatSimTime(event.simTime)}
                </span>
                <p className="min-w-0 flex-1 text-pretty">
                  <CharacterChip
                    id={event.actors[0]}
                    showAvatar={false}
                    className="-ms-1 align-baseline"
                  />
                  <span className="ms-1 text-ui-soft">
                    {event.payload.description}
                  </span>
                  {event.payload.where ? (
                    <>
                      {" "}
                      <PlaceChip
                        id={event.payload.where}
                        bare
                        quiet
                        className="align-baseline"
                      />
                    </>
                  ) : null}
                </p>
              </div>
            ) : null,
          )}
        </ChronicleMore>
      }
    />
  );
});
