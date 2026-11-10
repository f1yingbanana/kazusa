"use client";

import {
  ClockIcon,
  EyeIcon,
  MessageSquareDashedIcon,
  MessageSquareTextIcon,
  MoonIcon,
  PencilLineIcon,
  PlayIcon,
  TimerResetIcon,
  UserCogIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { JournalEvent, JournalKind } from "@kazusa/client";
import { Fragment, type ReactNode } from "react";
import {
  CharacterChip,
  ChatChip,
  PlaceChip,
} from "@/components/entities/chips";
import { taskLabel } from "@/components/entities/task-icon";
import {
  formatSimDuration,
  formatSimTime,
  formatSpeed,
  MINUTE,
} from "@/lib/time/sim";
import type { StageLink, TimelineKind } from "./types";

type KindMap = { [K in JournalKind]: TimelineKind<K> };

function openChat(chatId: string, messageId?: string): StageLink {
  return {
    view: "chats",
    params: {
      "chats.id": chatId,
      ...(messageId ? { "chats.msg": messageId } : {}),
    },
    label: "Open chat",
    observedLabel: "Peek chat",
  };
}

export const TIMELINE_KINDS: KindMap = {
  "task.started": {
    kind: "task.started",
    label: "Task started",
    icon: PlayIcon,
    facet: "task",
    salience: "low",
    fact: (event) => (
      <>
        <span className="text-muted-foreground">{`${taskLabel(event.payload.type)} · `}</span>
        <span>{event.payload.description}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {" · "}
          {formatSimDuration(event.payload.duration * MINUTE)}
        </span>
        {event.payload.where ? (
          <>
            <span className="text-muted-foreground">
              {event.payload.from ? " · heading to " : " · at "}
            </span>
            <PlaceChip id={event.payload.where} />
          </>
        ) : null}
      </>
    ),
    thought: (event) =>
      event.payload.monologue
        ? { by: event.actors[0], text: event.payload.monologue }
        : undefined,
    collapseKey: (event) => `task.started:${event.payload.type}`,
    target: (event) => ({ kind: "character", id: event.actors[0] }),
  },
  "task.delayed": {
    kind: "task.delayed",
    label: "Task extended",
    icon: TimerResetIcon,
    facet: "task",
    salience: "normal",
    fact: (event) => (
      <>
        Extended the current task, ending in{" "}
        <span className="font-mono">
          {formatSimDuration(Math.max(0, event.payload.endAt - event.simTime))}
        </span>
      </>
    ),
    thought: (event) => {
      const text = [event.payload.reason, event.payload.monologue]
        .filter(Boolean)
        .join(" ");
      return text ? { by: event.actors[0], text } : undefined;
    },
    target: (event) => ({ kind: "character", id: event.actors[0] }),
  },
  "message.sent": {
    kind: "message.sent",
    label: "Message",
    icon: MessageSquareTextIcon,
    facet: "chat",
    salience: "normal",
    // Chats already show every message; in the stream they drown out actions.
    hiddenByDefault: true,
    actors: (event) => [event.payload.senderId],
    fact: (event) => (
      <>
        in {event.chatId ? <ChatChip id={event.chatId} /> : "a chat"}
        <span className="text-muted-foreground">{": "}</span>
        <span>{`“${event.payload.preview}”`}</span>
      </>
    ),
    target: (event) =>
      event.chatId
        ? openChat(event.chatId, event.payload.messageId)
        : undefined,
  },
  "chat.created": {
    kind: "chat.created",
    label: "Chat created",
    icon: UsersRoundIcon,
    facet: "chat",
    salience: "normal",
    actors: (event) => event.actors.slice(0, 1),
    fact: (event) =>
      event.payload.type === "huddle" ? (
        // Untitled: face to face, the people are the conversation.
        <>
          Started talking with{" "}
          {event.payload.members
            .filter((id) => id !== event.actors[0])
            .slice(0, 3)
            .map((id) => (
              <CharacterChip key={id} id={id} />
            ))}
        </>
      ) : (
        <>
          Created {event.payload.type === "group" ? "group" : "chat"}{" "}
          <span className="font-medium">{event.payload.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{` · ${event.payload.members.length} members`}</span>
        </>
      ),
    target: (event) => (event.chatId ? openChat(event.chatId) : undefined),
  },
  "chat.renamed": {
    kind: "chat.renamed",
    label: "Chat renamed",
    icon: PencilLineIcon,
    facet: "chat",
    salience: "low",
    actors: (event) => event.actors.slice(0, 1),
    fact: (event) => (
      <>
        Renamed {event.chatId ? <ChatChip id={event.chatId} /> : "a chat"} to{" "}
        <span className="font-medium">{event.payload.title}</span>
      </>
    ),
    target: (event) => (event.chatId ? openChat(event.chatId) : undefined),
  },
  "chat.members_changed": {
    kind: "chat.members_changed",
    label: "Members changed",
    icon: UserCogIcon,
    facet: "chat",
    salience: "normal",
    actors: (event) => event.actors.slice(0, 1),
    fact: (event) => (
      <>
        {event.payload.added.length ? (
          <>
            Added{" "}
            {event.payload.added.slice(0, 3).map((id) => (
              <CharacterChip key={id} id={id} />
            ))}
          </>
        ) : null}
        {event.payload.removed.length ? (
          <>
            {" "}
            Removed{" "}
            {event.payload.removed.slice(0, 3).map((id) => (
              <CharacterChip key={id} id={id} />
            ))}
          </>
        ) : null}
        {event.chatId ? (
          <>
            {" "}
            in <ChatChip id={event.chatId} />
          </>
        ) : null}
      </>
    ),
    target: (event) => (event.chatId ? openChat(event.chatId) : undefined),
  },
  "clock.changed": {
    kind: "clock.changed",
    label: "Clock",
    icon: ClockIcon,
    facet: "world",
    salience: "high",
    fact: (event) =>
      event.payload.advancedMinutes !== undefined
        ? `Clock advanced ${formatSimDuration(event.payload.advancedMinutes * MINUTE)}`
        : `Speed set to ${formatSpeed(event.payload.speed ?? 0)}`,
  },
  "attention.decided": {
    kind: "attention.decided",
    label: "Attention",
    icon: MessageSquareDashedIcon,
    facet: "chat",
    salience: "normal",
    fact: (event) => {
      const { tunedOut, outcome, lines } = event.payload;
      // Setting a text aside already says until when.
      const activity =
        outcome === "deferred" && lines.length
          ? undefined
          : event.payload.activity;
      return (
        <>
          {passedLines(event.payload)}
          {tunedOut ? (
            <>
              {event.payload.lines.length ? "; stopped" : "Stopped"} following{" "}
              <ChatChip id={tunedOut} />
            </>
          ) : null}
          {activity ? (
            <span
              className="text-muted-foreground"
              title={activity.description}
            >{` · ${taskLabel(activity.type)}`}</span>
          ) : null}
        </>
      );
    },
    target: (event) => {
      const [first] = event.payload.lines;
      const chatId = first?.chatId ?? event.payload.tunedOut;
      return chatId ? openChat(chatId, first?.messageId) : undefined;
    },
  },
  "location.noticed": {
    kind: "location.noticed",
    label: "Noticed",
    icon: EyeIcon,
    facet: "social",
    salience: "normal",
    fact: (event) => {
      const { subjects, placeId, moment, between, word } = event.payload;
      return (
        <>
          <span className="text-muted-foreground">{NOTICED_LEAD[moment]} </span>
          {subjects.slice(0, 3).map((id) => (
            <CharacterChip key={id} id={id} />
          ))}
          {subjects.length > 3 ? (
            <span className="font-mono text-xs text-muted-foreground">{` +${subjects.length - 3}`}</span>
          ) : null}
          <span className="text-muted-foreground">
            {NOTICED_WHERE[moment]}{" "}
          </span>
          <PlaceChip id={placeId} />
          {between ? (
            <>
              <span className="text-muted-foreground"> and </span>
              <PlaceChip id={between} />
            </>
          ) : null}
          <span className="font-mono text-xs text-muted-foreground">{` · ${word}`}</span>
        </>
      );
    },
    target: (event) => ({ kind: "place", id: event.payload.placeId }),
  },
  "memory.consolidated": {
    kind: "memory.consolidated",
    label: "Slept on it",
    icon: MoonIcon,
    facet: "mind",
    salience: "normal",
    fact: (event) => {
      const { interrupted, pages, newPages } = event.payload;
      return interrupted ? (
        <span className="text-muted-foreground">
          Sleep was broken; nothing kept
        </span>
      ) : (
        <span className="text-muted-foreground">
          {`Rethought ${pages.length} ${pages.length === 1 ? "thing" : "things"}${newPages.length ? `, ${newPages.length} new` : ""}`}
        </span>
      );
    },
    thought: (event) =>
      event.payload.dream
        ? { by: event.actors[0], text: event.payload.dream }
        : undefined,
  },
};

const NOTICED_LEAD = {
  arrive: "Walked in on",
  comes: "Saw",
  cross: "Crossed paths with",
  meet: "Passed",
} as const;

const NOTICED_WHERE = {
  arrive: " at",
  comes: " come into",
  cross: " at",
  meet: " between",
} as const;

/**
 * Pickup delays are often under a minute, which `formatSimDuration` floors to
 * 0m.
 */
type AttentionPayload = Extract<
  JournalEvent,
  { kind: "attention.decided" }
>["payload"];

/** "Momoi's", or "Momoi's and Yuzu's". */
function whose(senders: readonly string[]): ReactNode {
  return senders.map((id, index) => (
    <Fragment key={id}>
      {index > 0 ? (index === senders.length - 1 ? " and " : ", ") : null}
      <CharacterChip id={id} />
      {"'s"}
    </Fragment>
  ));
}

/**
 * What became of the lines, in a few words: a text left unread or set aside, or
 * the player unheard in person. One line shows its start.
 */
function passedLines({
  outcome,
  lines,
  activity,
}: AttentionPayload): ReactNode {
  if (!outcome || !lines.length) return null;
  const senders = [...new Set(lines.map((line) => line.sender))];
  const chats = new Set(lines.map((line) => line.chatId));
  const inPerson = lines.every((line) => line.chatId.startsWith("huddle:"));
  const group = chats.size === 1 && lines[0].chatId.startsWith("group:");
  const what =
    lines.length === 1
      ? inPerson
        ? "words"
        : "text"
      : `${lines.length} ${inPerson ? "lines" : "texts"}`;
  const said = (
    <>
      {senders.length <= 2 ? <>{whose(senders)} </> : null}
      {what}
      {group ? (
        <>
          {" in "}
          <ChatChip id={lines[0].chatId} />
        </>
      ) : null}
    </>
  );
  const quote =
    lines.length === 1 ? (
      <span className="text-muted-foreground">{`: “${lines[0].excerpt}”`}</span>
    ) : null;
  if (outcome === "ignored")
    return inPerson ? (
      <>
        Didn&apos;t catch {said}
        {quote}
      </>
    ) : (
      <>
        Left {said} unread{quote}
      </>
    );
  return (
    <>
      Set {said} aside
      {activity
        ? ` until ${taskLabel(activity.type)} ends (${formatSimTime(activity.endAt)})`
        : " for later"}
      {quote}
    </>
  );
}

export const TIMELINE_KIND_LIST = Object.values(
  TIMELINE_KINDS,
) as TimelineKind[];

/** What the Timeline shows with no `tl.kinds` param. */
export const DEFAULT_TIMELINE_KINDS: readonly JournalKind[] =
  TIMELINE_KIND_LIST.filter((kind) => !kind.hiddenByDefault).map(
    (kind) => kind.kind,
  );

/**
 * The inspector's Recent: what the character did and ran into, without what
 * goes on in their head (the `mind` facet), which stays in the Timeline.
 */
export const RECENT_KINDS: readonly JournalKind[] = TIMELINE_KIND_LIST.filter(
  (kind) => !kind.hiddenByDefault && kind.facet !== "mind",
).map((kind) => kind.kind);

/** `tl.kinds` absent means the default set, not every kind. */
export function effectiveTimelineKinds(
  param: readonly JournalKind[],
): readonly JournalKind[] {
  return param.length ? param : DEFAULT_TIMELINE_KINDS;
}

/** The `tl.kinds` value for a selection: null when it equals the default. */
export function timelineKindsParam(kinds: readonly JournalKind[]) {
  const isDefault =
    kinds.length === DEFAULT_TIMELINE_KINDS.length &&
    DEFAULT_TIMELINE_KINDS.every((kind) => kinds.includes(kind));
  return isDefault ? null : [...kinds];
}

/**
 * Typed accessor: TS can't correlate `event.kind` with the map entry on its
 * own.
 */
export function kindOf<E extends JournalEvent>(event: E) {
  return TIMELINE_KINDS[event.kind] as unknown as TimelineKind<E["kind"]> & {
    fact: (event: E) => React.ReactNode;
    thought?: (event: E) => ReturnType<NonNullable<TimelineKind["thought"]>>;
    actors?: (event: E) => readonly string[];
    target?: (event: E) => ReturnType<NonNullable<TimelineKind["target"]>>;
  };
}
