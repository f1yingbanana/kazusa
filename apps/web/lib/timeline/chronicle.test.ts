import type { JournalEvent } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import {
  buildChronicle,
  DEFAULT_TIMELINE_KINDS,
  effectiveTimelineKinds,
  HIGHLIGHT_KINDS,
  kindsForPreset,
  matchesEventQuery,
  presetOfKinds,
  timelineKindsParam,
  type EventNameLookup,
} from "./chronicle";
import { HOUR, MINUTE } from "@/lib/time/sim";

const DAY_0 = Date.UTC(2026, 10, 24, 0, 0);
const DAY_1 = Date.UTC(2026, 10, 25, 0, 0);

const events: JournalEvent[] = [
  {
    seq: 7,
    simTime: DAY_1 + 19 * HOUR + 15 * MINUTE, // Evening
    kind: "location.noticed",
    actors: ["airi"],
    payload: {
      subjects: ["natsu"],
      placeId: "cafe",
      moment: "arrive",
      word: "spotted",
      probability: 0.8,
      roll: 0.25,
      source: "test",
    },
  },
  {
    seq: 6,
    simTime: DAY_1 + 14 * HOUR, // Afternoon
    kind: "task.started",
    actors: ["airi"],
    payload: {
      taskId: "t1",
      type: "eating",
      description: "Having parfaits",
      duration: 45,
      endAt: DAY_1 + 14 * HOUR + 45 * MINUTE,
      where: "cafe",
      monologue: "Sugar fixes everything.",
    },
  },
  {
    seq: 5,
    simTime: DAY_1 + 10 * HOUR, // Morning
    kind: "task.started",
    actors: ["airi"],
    payload: {
      taskId: "t3",
      type: "studying",
      description: "Reviewing math",
      duration: 30,
      endAt: DAY_1 + 10 * HOUR + 30 * MINUTE,
      where: "library",
    },
  },
  {
    seq: 4,
    simTime: DAY_1 + 9 * HOUR, // Morning
    kind: "task.started",
    actors: ["natsu"],
    payload: {
      taskId: "t2",
      type: "studying",
      description: "Reading philosophy",
      duration: 60,
      endAt: DAY_1 + 10 * HOUR,
      where: "library",
    },
  },
  {
    seq: 3,
    simTime: DAY_0 + 23 * HOUR, // Night (23:00)
    kind: "memory.consolidated",
    actors: ["airi"],
    payload: {
      runId: "r1",
      from: DAY_0,
      to: DAY_0 + 23 * HOUR,
      pages: ["natsu", "cafe"],
      newPages: ["cafe"],
      notes: 2,
      dream: "A giant strawberry cake on the rooftop.",
    },
  },
  {
    seq: 2,
    simTime: DAY_0 + 10 * HOUR, // Morning
    kind: "clock.changed",
    actors: [],
    payload: { speed: 10 },
  },
];

const names: EventNameLookup = {
  characterName: (id) =>
    ({ airi: "Airi Kurimura", natsu: "Natsu Yutori" })[id] ?? id,
  placeName: (id) =>
    ({ cafe: "Sweet Cafe", library: "Central Library" })[id] ?? id,
  chatTitle: (id) => id,
};

describe("chronicle helpers", () => {
  it("groups by day and phase and collapses consecutive quiet task bursts", () => {
    const rows = buildChronicle(events);
    expect(
      rows.map((r) =>
        r.type === "day"
          ? `day:${r.count}`
          : r.type === "phase"
            ? `phase:${r.phase}`
            : r.type === "burst"
              ? `burst:${r.label}:${r.events.length}`
              : `event:${r.event.seq}`,
      ),
    ).toEqual([
      "day:4",
      "phase:Evening",
      "event:7",
      "phase:Afternoon",
      "event:6",
      "phase:Morning",
      "burst:studying:2",
      "day:2",
      "phase:Night",
      "event:3",
      "phase:Morning",
      "event:2",
    ]);
  });

  it("matches search queries against resolved names, monologues, dreams, and places", () => {
    expect(matchesEventQuery(events[0], "spotted", names)).toBe(true);
    expect(matchesEventQuery(events[0], "sweet cafe", names)).toBe(true);
    expect(matchesEventQuery(events[1], "sugar", names)).toBe(true);
    expect(matchesEventQuery(events[4], "strawberry", names)).toBe(true);
    expect(matchesEventQuery(events[3], "natsu", names)).toBe(true);
    expect(matchesEventQuery(events[3], "parfaits", names)).toBe(false);
  });

  it("maps presets and defaults cleanly for tl.kinds", () => {
    expect(effectiveTimelineKinds([])).toEqual(DEFAULT_TIMELINE_KINDS);
    expect(DEFAULT_TIMELINE_KINDS).not.toContain("message.sent");
    expect(DEFAULT_TIMELINE_KINDS).not.toContain("clock.changed");
    expect(DEFAULT_TIMELINE_KINDS).not.toContain("task.stopped");
    expect(DEFAULT_TIMELINE_KINDS).not.toContain("attention.decided");
    expect(timelineKindsParam(DEFAULT_TIMELINE_KINDS)).toBeNull();
    expect(presetOfKinds(HIGHLIGHT_KINDS)).toBe("highlights");
    expect(presetOfKinds(DEFAULT_TIMELINE_KINDS)).toBe("activity");
    expect(presetOfKinds(kindsForPreset("everything"))).toBe("everything");
    expect(presetOfKinds(["task.started"])).toBeNull();
  });
});
