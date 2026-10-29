"use client";

import {
  BrainIcon,
  ClockIcon,
  EyeIcon,
  MessageSquareTextIcon,
  PencilLineIcon,
  PlayIcon,
  TimerResetIcon,
  UserCogIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { JournalEvent, JournalKind } from "@kazusa/client";
import {
  CharacterChip,
  ChatChip,
  PlaceChip,
} from "@/components/entities/chips";
import { taskLabel } from "@/components/entities/task-icon";
import { formatSimDuration, formatSpeed, MINUTE } from "@/lib/time/sim";
import type { TimelineKind } from "./types";

type KindMap = { [K in JournalKind]: TimelineKind<K> };

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
        Extended the current task by{" "}
        <span className="font-mono">
          {formatSimDuration(event.payload.additionalMinutes * MINUTE)}
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
        ? {
            view: "chats",
            params: {
              "chats.id": event.chatId,
              "chats.msg": event.payload.messageId,
            },
            label: "Open chat",
          }
        : undefined,
  },
  "chat.created": {
    kind: "chat.created",
    label: "Chat created",
    icon: UsersRoundIcon,
    facet: "chat",
    salience: "normal",
    actors: (event) => event.actors.slice(0, 1),
    fact: (event) => (
      <>
        Created {event.payload.type === "group" ? "group" : "chat"}{" "}
        <span className="font-medium">{event.payload.title}</span>
        <span className="font-mono text-xs text-muted-foreground">{` · ${event.payload.members.length} members`}</span>
      </>
    ),
    target: (event) =>
      event.chatId ? { kind: "chat", id: event.chatId } : undefined,
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
    icon: BrainIcon,
    facet: "mind",
    salience: "low",
    fact: (event) => {
      const {
        action,
        delayMs,
        question,
        source,
        choice,
        latencyScore,
        note,
        stimulusIds,
      } = event.payload;
      const outcome =
        action === "IGNORE"
          ? "Ignored"
          : action === "DEFER"
            ? "Deferred until the current activity ends"
            : action === "QUEUE_NEXT"
              ? "Queued after the current thought"
              : question === "attention_allocation"
                ? "Interrupted the current thought"
                : delayMs > 0
                  ? `Noticed after ${formatDelay(delayMs)}`
                  : "Noticed immediately";
      const why =
        source === "model"
          ? [choice, latencyScore !== undefined && `score ${latencyScore}`]
              .filter(Boolean)
              .join(" · ")
          : source === "fallback"
            ? `fallback${note ? `: ${note}` : ""}`
            : "automatic";
      return (
        <>
          <span>{outcome}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {` · ${stimulusIds.length} ${stimulusIds.length === 1 ? "stimulus" : "stimuli"} · ${why}`}
          </span>
        </>
      );
    },
    target: (event) => ({ kind: "character", id: event.actors[0] }),
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
function formatDelay(ms: number) {
  return ms < MINUTE ? `${Math.round(ms / 1000)}s` : formatSimDuration(ms);
}

export const TIMELINE_KIND_LIST = Object.values(
  TIMELINE_KINDS,
) as TimelineKind[];

/** What the Timeline and the inspector's Recent show with no `tl.kinds` param. */
export const DEFAULT_TIMELINE_KINDS: readonly JournalKind[] =
  TIMELINE_KIND_LIST.filter((kind) => !kind.hiddenByDefault).map(
    (kind) => kind.kind,
  );

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
  return isDefault ? null : kinds.join(",");
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
