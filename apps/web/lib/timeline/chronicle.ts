import {
  JOURNAL_KINDS,
  type JournalEvent,
  type JournalKind,
} from "@kazusa/client";
import { simDayStart, simPhase, type DayPhase } from "@/lib/time/sim";

export type TimelineFacetId = "task" | "social" | "chat" | "mind" | "world";

export interface TimelineFacetSpec {
  readonly id: TimelineFacetId;
  readonly label: string;
  readonly kinds: readonly JournalKind[];
}

export const TIMELINE_FACETS: readonly TimelineFacetSpec[] = [
  {
    id: "social",
    label: "Encounters",
    kinds: ["location.noticed"],
  },
  {
    id: "mind",
    label: "Sleep & dreams",
    kinds: ["memory.consolidated"],
  },
  {
    id: "chat",
    label: "Chats",
    kinds: [
      "chat.created",
      "chat.members_changed",
      "chat.renamed",
      "attention.decided",
      "message.sent",
    ],
  },
  {
    id: "task",
    label: "Activities",
    kinds: ["task.started", "task.delayed", "task.stopped"],
  },
  {
    id: "world",
    label: "Clock",
    kinds: ["clock.changed"],
  },
];

export const KIND_LABEL: Record<JournalKind, string> = {
  "task.started": "Started",
  "task.delayed": "Stayed longer",
  "task.stopped": "Interrupted",
  "message.sent": "Messages",
  "chat.created": "New talk",
  "chat.renamed": "Renamed",
  "chat.members_changed": "Members changed",
  "clock.changed": "Clock",
  "attention.decided": "Ignored / deferred",
  "location.noticed": "Noticed",
  "memory.consolidated": "Sleep & dreams",
};

export const KIND_FACET: Record<JournalKind, TimelineFacetId> = {
  "task.started": "task",
  "task.delayed": "task",
  "task.stopped": "task",
  "location.noticed": "social",
  "message.sent": "chat",
  "chat.created": "chat",
  "chat.renamed": "chat",
  "chat.members_changed": "chat",
  "attention.decided": "chat",
  "memory.consolidated": "mind",
  "clock.changed": "world",
};

/** Signal-focused story beats: encounters, new talks, group changes, and dreams. */
export const HIGHLIGHT_KINDS: readonly JournalKind[] = [
  "location.noticed",
  "chat.created",
  "chat.members_changed",
  "memory.consolidated",
];

const NOISE_IN_DEFAULT = new Set<JournalKind>([
  "message.sent",
  "clock.changed",
  "task.stopped",
  "attention.decided",
]);

export const DEFAULT_TIMELINE_KINDS: readonly JournalKind[] =
  JOURNAL_KINDS.filter((kind) => !NOISE_IN_DEFAULT.has(kind));

export type TimelinePreset = "highlights" | "activity" | "everything";

export function kindsForPreset(preset: TimelinePreset): readonly JournalKind[] {
  if (preset === "highlights") return HIGHLIGHT_KINDS;
  if (preset === "everything") return JOURNAL_KINDS;
  return DEFAULT_TIMELINE_KINDS;
}

export function presetOfKinds(
  kinds: readonly JournalKind[],
): TimelinePreset | null {
  const same = (target: readonly JournalKind[]) =>
    kinds.length === target.length && target.every((k) => kinds.includes(k));
  if (same(HIGHLIGHT_KINDS)) return "highlights";
  if (same(DEFAULT_TIMELINE_KINDS)) return "activity";
  if (same(JOURNAL_KINDS)) return "everything";
  return null;
}

export function effectiveTimelineKinds(
  param: readonly JournalKind[],
): readonly JournalKind[] {
  return param.length ? param : DEFAULT_TIMELINE_KINDS;
}

export function timelineKindsParam(
  kinds: readonly JournalKind[],
): JournalKind[] | null {
  const isDefault =
    kinds.length === DEFAULT_TIMELINE_KINDS.length &&
    DEFAULT_TIMELINE_KINDS.every((kind) => kinds.includes(kind));
  return isDefault ? null : [...kinds];
}

export type ChronicleRow =
  | {
      readonly type: "day";
      readonly key: string;
      readonly start: number;
      readonly count: number;
    }
  | {
      readonly type: "phase";
      readonly key: string;
      readonly dayStart: number;
      readonly phase: DayPhase;
    }
  | {
      readonly type: "event";
      readonly key: string;
      readonly event: JournalEvent;
      readonly dayStart: number;
      readonly phase: DayPhase;
    }
  | {
      readonly type: "burst";
      readonly key: string;
      readonly category: "task" | "message";
      readonly label: string;
      readonly chatId?: string;
      readonly events: readonly JournalEvent[];
      readonly dayStart: number;
      readonly phase: DayPhase;
    };

function burstSignature(event: JournalEvent): {
  readonly category: "task" | "message";
  readonly key: string;
  readonly label: string;
  readonly chatId?: string;
} | null {
  if (event.kind === "task.started" && !event.payload.monologue) {
    return {
      category: "task",
      key: `task:${event.payload.type}`,
      label: event.payload.type,
    };
  }
  if (event.kind === "message.sent" && event.chatId) {
    return {
      category: "message",
      key: `msg:${event.chatId}`,
      label: event.chatId,
      chatId: event.chatId,
    };
  }
  return null;
}

/**
 * Groups newest-first events by sim day and phase of day, collapsing
 * consecutive quiet task starts of the same category or message bursts in the
 * same chat.
 */
export function buildChronicle(
  events: readonly JournalEvent[],
): ChronicleRow[] {
  const countsByDay = new Map<number, number>();
  for (const event of events) {
    const start = simDayStart(event.simTime);
    countsByDay.set(start, (countsByDay.get(start) ?? 0) + 1);
  }

  const rows: ChronicleRow[] = [];
  let currentDay: number | null = null;
  let currentPhase: DayPhase | null = null;

  let index = 0;
  while (index < events.length) {
    const event = events[index];
    const dayStart = simDayStart(event.simTime);
    const phase = simPhase(event.simTime);

    if (dayStart !== currentDay) {
      currentDay = dayStart;
      currentPhase = null;
      rows.push({
        type: "day",
        key: `day-${dayStart}`,
        start: dayStart,
        count: countsByDay.get(dayStart) ?? 0,
      });
    }
    if (phase !== currentPhase) {
      currentPhase = phase;
      rows.push({
        type: "phase",
        key: `phase-${dayStart}-${phase}-${event.seq}`,
        dayStart,
        phase,
      });
    }

    const sig = burstSignature(event);
    if (sig) {
      const group: JournalEvent[] = [event];
      let nextIndex = index + 1;
      while (nextIndex < events.length) {
        const candidate = events[nextIndex];
        if (
          simDayStart(candidate.simTime) !== dayStart ||
          simPhase(candidate.simTime) !== phase
        ) {
          break;
        }
        const candidateSig = burstSignature(candidate);
        if (!candidateSig || candidateSig.key !== sig.key) break;
        group.push(candidate);
        nextIndex += 1;
      }

      if (group.length >= 2) {
        rows.push({
          type: "burst",
          key: `burst-${event.seq}`,
          category: sig.category,
          label: sig.label,
          chatId: sig.chatId,
          events: group,
          dayStart,
          phase,
        });
        index = nextIndex;
        continue;
      }
    }

    rows.push({
      type: "event",
      key: `e-${event.seq}`,
      event,
      dayStart,
      phase,
    });
    index += 1;
  }

  return rows;
}

export interface EventNameLookup {
  readonly characterName: (id: string) => string;
  readonly placeName: (id: string) => string;
  readonly chatTitle: (id: string) => string;
}

/** Matches a journal event against a free-text filter using resolved names. */
export function matchesEventQuery(
  event: JournalEvent,
  rawQuery: string,
  names: EventNameLookup,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const has = (text: string | undefined) =>
    Boolean(text && text.toLowerCase().includes(q));

  if (has(KIND_LABEL[event.kind])) return true;
  if (event.actors.some((id) => has(names.characterName(id)) || has(id)))
    return true;
  if (
    event.placeId &&
    (has(names.placeName(event.placeId)) || has(event.placeId))
  )
    return true;
  if (event.chatId && has(names.chatTitle(event.chatId))) return true;

  switch (event.kind) {
    case "task.started":
      return (
        has(event.payload.type) ||
        has(event.payload.description) ||
        has(event.payload.monologue) ||
        has(event.payload.spot) ||
        has(event.payload.unknown) ||
        (event.payload.where
          ? has(names.placeName(event.payload.where))
          : false) ||
        (event.payload.from ? has(names.placeName(event.payload.from)) : false)
      );
    case "task.delayed":
      return has(event.payload.reason) || has(event.payload.monologue);
    case "task.stopped":
      return has(event.payload.type) || has(event.payload.description);
    case "message.sent":
      return (
        has(event.payload.preview) ||
        has(names.characterName(event.payload.senderId))
      );
    case "chat.created":
      return (
        has(event.payload.title) ||
        event.payload.members.some((id) => has(names.characterName(id)))
      );
    case "chat.renamed":
      return has(event.payload.title);
    case "chat.members_changed":
      return (
        event.payload.added.some((id) => has(names.characterName(id))) ||
        event.payload.removed.some((id) => has(names.characterName(id)))
      );
    case "clock.changed":
      return has("clock") || has("speed");
    case "attention.decided":
      return (
        event.payload.lines.some(
          (line) =>
            has(line.excerpt) ||
            has(names.characterName(line.sender)) ||
            has(names.chatTitle(line.chatId)),
        ) ||
        has(event.payload.activity?.description) ||
        (event.payload.tunedOut
          ? has(names.chatTitle(event.payload.tunedOut))
          : false)
      );
    case "location.noticed":
      return (
        has(event.payload.word) ||
        has(names.placeName(event.payload.placeId)) ||
        (event.payload.between
          ? has(names.placeName(event.payload.between))
          : false) ||
        event.payload.subjects.some((id) => has(names.characterName(id)))
      );
    case "memory.consolidated":
      return (
        has(event.payload.dream) ||
        event.payload.pages.some((p) => has(p)) ||
        event.payload.newPages.some((p) => has(p))
      );
  }
}
