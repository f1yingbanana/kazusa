// @vitest-environment jsdom
import type { CharacterSummary, JournalEvent, Place } from "@kazusa/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "@/ui/agent";
import { TimelineSidebar } from "./timeline-sidebar";
import { TimelineStage } from "./timeline-stage";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

const loadMore = vi.fn();

const airi: CharacterSummary = {
  id: "airi",
  name: "Airi Kurimura",
  kind: "agent",
  aliases: ["Airi"],
  groups: ["sweets_club"],
  status: {
    brain: "idle",
    composingIn: [],
    queued: 0,
    onstage: true,
  },
};

const natsu: CharacterSummary = {
  id: "natsu",
  name: "Natsu Yutori",
  kind: "agent",
  aliases: ["Natsu"],
  groups: ["sweets_club"],
  status: {
    brain: "idle",
    composingIn: [],
    queued: 0,
    onstage: true,
  },
};

const cafe: Place = {
  id: "cafe",
  name: "Sweet Cafe",
  aliases: [],
  summary: "",
  entryMinutes: 1,
  connections: [],
  bodyMarkdown: "",
};

const DAY_1 = Date.UTC(2026, 10, 25, 0, 0);

const sampleEvents: JournalEvent[] = [
  {
    seq: 5,
    simTime: DAY_1 + 14 * 60 * 60_000,
    kind: "location.noticed",
    actors: ["airi"],
    payload: {
      subjects: ["natsu"],
      placeId: "cafe",
      moment: "arrive",
      word: "spotted",
      probability: 0.75,
      roll: 0.4,
      source: "test",
    },
  },
  {
    seq: 4,
    simTime: DAY_1 + 11 * 60 * 60_000,
    kind: "task.started",
    actors: ["airi"],
    payload: {
      taskId: "t1",
      type: "eating",
      description: "Having parfaits",
      duration: 30,
      endAt: DAY_1 + 11 * 60 * 60_000 + 30 * 60_000,
      where: "cafe",
      monologue: "Best dessert in town.",
    },
  },
  {
    seq: 3,
    simTime: DAY_1 + 9 * 60 * 60_000 + 15 * 60_000,
    kind: "task.started",
    actors: ["airi"],
    payload: {
      taskId: "t2",
      type: "studying",
      description: "Reviewing notes",
      duration: 30,
      endAt: DAY_1 + 9 * 60 * 60_000 + 45 * 60_000,
      where: "cafe",
    },
  },
  {
    seq: 2,
    simTime: DAY_1 + 9 * 60 * 60_000,
    kind: "task.started",
    actors: ["natsu"],
    payload: {
      taskId: "t3",
      type: "studying",
      description: "Reading philosophy",
      duration: 45,
      endAt: DAY_1 + 9 * 60 * 60_000 + 45 * 60_000,
      where: "cafe",
    },
  },
  {
    seq: 1,
    simTime: DAY_1 + 2 * 60 * 60_000,
    kind: "memory.consolidated",
    actors: ["natsu"],
    payload: {
      runId: "r1",
      from: DAY_1 - 24 * 60 * 60_000,
      to: DAY_1,
      pages: ["airi", "cafe"],
      newPages: ["cafe"],
      notes: 1,
      dream: "A quiet afternoon.",
    },
  },
];

vi.mock("@/hooks/use-timeline", () => ({
  useTimeline: () => ({
    events: sampleEvents,
    error: undefined,
    isLoading: false,
    hasMore: true,
    isLoadingMore: false,
    loadMore,
    source: "live",
  }),
}));

vi.mock("@/hooks/use-characters", () => ({
  useCharacters: () => ({
    characters: [airi, natsu],
    byId: new Map([
      ["airi", airi],
      ["natsu", natsu],
    ]),
  }),
  useCharacter: (id: string) =>
    id === "airi" ? airi : id === "natsu" ? natsu : undefined,
  useCharacterStatus: () => undefined,
}));

vi.mock("@/hooks/use-location", () => ({
  usePlaces: () => ({
    places: [cafe],
    byId: new Map([["cafe", cafe]]),
    children: new Map(),
    times: [{ name: "Morning", from: "05:00" }],
    backdrops: {},
  }),
  usePlace: (id: string) => (id === "cafe" ? cafe : undefined),
}));

vi.mock("@/hooks/use-chats", () => ({
  useChats: () => ({ chats: [] }),
}));

vi.mock("@/hooks/use-observed-chats", () => ({
  useObservedChats: () => ({ chats: [], available: true }),
  useObservedChat: () => ({ chat: undefined }),
}));

vi.mock("@/hooks/use-clock", () => ({
  useSimNow: () => DAY_1 + 15 * 60 * 60_000,
  useClockAnchor: () => ({
    clock: {
      simTime: DAY_1 + 15 * 60 * 60_000,
      speed: 1,
      updatedAt: Date.now(),
    },
    offset: 0,
  }),
}));

vi.mock("@/hooks/use-wiki", () => ({
  usePageName: () => (id: string) =>
    ({
      airi: "Airi Kurimura",
      cafe: "Sweet Cafe",
      sweets_club: "After-School Sweets Club",
    })[id] ?? id,
}));

vi.mock("@/hooks/use-selection", () => ({
  useSelection: () => [null, vi.fn()],
}));

vi.mock("@/hooks/use-self", () => ({
  useSelfIn: () => () => "",
}));

vi.mock("@/lib/source/provider", () => ({
  useSources: () => ({
    player: { id: "", name: "" },
    operator: { id: "user:me", name: "Me" },
    watching: true,
    resolved: { timeline: "live" },
  }),
}));

vi.mock("@/lib/state/preferences-store", () => ({
  useWatchlist: () => ["airi"],
}));

vi.mock("../legacy", () => ({
  chatIcon: () => () => null,
  useChatTitle: () => ({
    title: "Chat",
    type: "direct",
    mine: false,
    readable: false,
    members: [],
  }),
  wikiParsers: {
    "wiki.page": { parse: (v: string) => v, serialize: (v: string) => v },
    "wiki.agent": { parse: (v: string) => v, serialize: (v: string) => v },
    "wiki.part": { parse: (v: string) => v, serialize: (v: string) => v },
    "wiki.edit": { parse: (v: string) => v, serialize: (v: string) => v },
    "wiki.raw": { parse: (v: string) => v, serialize: (v: string) => v },
  },
  chatsParsers: {
    "chats.id": { parse: (v: string) => v, serialize: (v: string) => v },
  },
}));

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: "[popover] { display: block !important }",
    }),
  );
});

beforeEach(() => {
  loadMore.mockClear();
});

afterEach(cleanup);

const agent = createAgent();

function TimelineHarness({
  searchParams = "?view=timeline",
  onUrlUpdate,
}: {
  searchParams?: string;
  onUrlUpdate?: (event: UrlUpdateEvent) => void;
}) {
  const Wrapper = withNuqsTestingAdapter({
    searchParams,
    onUrlUpdate,
    hasMemory: true,
  });
  return createElement(
    Wrapper as ({ children }: { children: ReactNode }) => ReactNode,
    null,
    createElement(
      "div",
      null,
      createElement(TimelineSidebar),
      createElement(TimelineStage),
    ),
  );
}

describe("Timeline feature", () => {
  it("exposes named stage and sidebar controls to an agent and collapses routine bursts", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    render(createElement(TimelineHarness, { onUrlUpdate }));

    expect(screen.getByText("Several people studying")).toBeDefined();
    // Accent thought is visible inline without a dropdown wrapper.
    expect(screen.getByText("Best dessert in town.")).toBeDefined();

    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    for (const entry of entries) {
      expect(entry.label).toBeTruthy();
    }

    const labels = entries.map((entry) => entry.label);
    for (const expected of [
      "Search cast and clubs",
      "Search events",
      "Detail level",
      "Event types",
      "Show studying notes",
      "Encounter roll",
      "Memories updated",
      "Load earlier events",
    ]) {
      expect(labels).toContain(expected);
    }

    fireEvent.click(screen.getByRole("button", { name: /Favorites/ }));

    const result = await agent.act({
      steps: [
        { ref: "Detail level", action: "setValue", args: ["Everything"] },
        { ref: "Show studying notes", action: "open" },
        { ref: "Encounter roll", action: "open" },
      ],
    });
    expect(result.error?.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(screen.getByText(/75% chance/)).toBeDefined();
    expect(screen.getByText("Reviewing notes")).toBeDefined();

    const searchRes = await agent.act({
      steps: [
        { ref: "Search events", action: "setValue", args: ["parfaits"] },
      ],
    });
    expect(searchRes.error?.message).toBeUndefined();
    expect(searchRes.ok).toBe(true);
    expect(screen.getByText(/Having parfaits/)).toBeDefined();
    expect(screen.queryByText(/dreamed overnight/i)).toBeNull();

    const lastSearch = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams;
    expect(lastSearch?.get("tl.watch")).toBe("1");
    expect(lastSearch?.get("tl.q")).toBe("parfaits");
    expect(lastSearch?.get("tl.kinds")).toContain("message.sent");
  });

  it("lets a person follow an entire club, pick individuals inside it, and open the filter popover", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    render(createElement(TimelineHarness, { onUrlUpdate }));

    fireEvent.click(
      screen.getByRole("button", { name: /^After-School Sweets Club/ }),
    );
    await waitFor(() => {
      expect(
        onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("tl.actors"),
      ).toBe("airi,natsu");
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show people in After-School Sweets Club",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Stop following Natsu Yutori" }),
    );
    await waitFor(() => {
      expect(
        onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("tl.actors"),
      ).toBe("airi");
    });

    const popover = agent
      .snapshot()
      .find(
        (entry) =>
          !entry.offPage &&
          entry.component === "popover" &&
          entry.label === "Event types",
      );
    expect(popover?.ref).toBeTruthy();
    const openPopover = await agent.act({
      steps: [{ ref: popover!.ref, action: "open" }],
    });
    expect(openPopover.error?.message).toBeUndefined();
    expect(openPopover.ok).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Messages" })).toBeDefined();

    const loadRes = await agent.act({
      steps: [{ ref: "Load earlier events", action: "press" }],
    });
    expect(loadRes.error?.message).toBeUndefined();
    expect(loadRes.ok).toBe(true);
    expect(loadMore).toHaveBeenCalledOnce();
  });
});
