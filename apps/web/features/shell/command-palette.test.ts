// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  withNuqsTestingAdapter,
  type UrlUpdateEvent,
} from "nuqs/adapters/testing";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPlaceIndex } from "@/lib/location/places";
import {
  resetPreferences,
  usePreferencesStore,
} from "@/lib/state/preferences-store";
import { createAgent } from "@/ui/agent";
import { CommandPalette } from "./command-palette";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

const PLACES = buildPlaceIndex([
  {
    id: "abydos",
    name: "Abydos",
    aliases: [],
    summary: "A desert district.",
    entryMinutes: 0,
    connections: [],
    bodyMarkdown: "",
  },
  {
    id: "abydos-high",
    name: "Abydos High School",
    aliases: [],
    parent: "abydos",
    summary: "A school half-buried in sand.",
    entryMinutes: 5,
    connections: [],
    bodyMarkdown: "",
  },
]);

const CHARACTERS = [
  {
    id: "hoshino",
    name: "Hoshino Takanashi",
    kind: "agent",
    groups: ["foreclosure-task-force"],
    summary: "Sleepy upperclassman.",
    aliases: ["Hoshino"],
  },
  {
    id: "shiroko",
    name: "Shiroko Sunaookami",
    kind: "agent",
    groups: ["foreclosure-task-force"],
    summary: "Cycles everywhere.",
    aliases: [],
    status: { onstage: false },
  },
];

vi.mock("@/hooks/use-characters", () => ({
  isCast: (c?: { kind: string; isSystemAgent?: boolean }) =>
    c?.kind === "agent" && !c.isSystemAgent,
  useCharacters: () => ({
    characters: CHARACTERS,
    byId: new Map(CHARACTERS.map((c) => [c.id, c])),
  }),
}));

vi.mock("@/hooks/use-chats", () => ({
  useChats: () => ({
    chats: [
      {
        id: "dm-hoshino",
        type: "direct",
        name: "Hoshino",
        members: ["user:sensei", "hoshino"],
      },
    ],
  }),
}));

vi.mock("@/hooks/use-observed-chats", () => ({
  useObservedChats: () => ({
    available: true,
    chats: [
      {
        id: "talk-1",
        type: "huddle",
        name: "Talk at Abydos High School",
        members: ["hoshino", "shiroko"],
        placeId: "abydos-high",
        ended: false,
      },
    ],
  }),
}));

vi.mock("@/hooks/use-location", () => ({
  usePlaces: () => PLACES,
  usePosition: (id?: string) =>
    id === "hoshino" ? { kind: "at", placeId: "abydos-high" } : undefined,
}));

vi.mock("@/hooks/use-wiki", () => ({
  useWikiList: () => ({
    data: {
      pages: [
        {
          id: "foreclosure-task-force",
          name: "Foreclosure Task Force",
          group: true,
          summary: "Abydos's student council, all five of them.",
          aliases: [],
        },
      ],
    },
  }),
}));

vi.mock("@/hooks/use-access", () => ({
  useAccess: () => ({
    canPlay: true,
    canMaintain: true,
    hasPermission: () => true,
  }),
}));

vi.mock("@/lib/source/provider", () => ({
  useSources: () => ({
    resolved: {
      wiki: "live",
      chats: "live",
      characters: "live",
      timeline: "live",
    },
    watching: false,
    player: { id: "user:sensei", name: "Sensei" },
    operator: { id: "user:sensei", name: "Sensei" },
  }),
}));

vi.mock("@/hooks/use-self", () => ({
  useSelfIn: () => () => "user:sensei",
}));

vi.mock("@/hooks/use-clock", () => ({
  useClockAnchor: () => ({ clock: { speed: 1 } }),
  useClockActions: () => ({ apply: vi.fn(), enabled: true }),
}));

vi.mock("@/lib/state/preferences-store", async (original) => ({
  ...(await original<object>()),
  useWatchlist: () => ["shiroko"],
}));

vi.mock("./sections", async () => {
  const { GlobeIcon, MessagesSquareIcon } = await import("lucide-react");
  return {
    useSections: () => [
      { id: "world", label: "World", icon: GlobeIcon },
      { id: "chats", label: "Chats", icon: MessagesSquareIcon },
    ],
  };
});

vi.mock("../settings/settings-sidebar", async () => {
  const { HistoryIcon } = await import("lucide-react");
  return {
    useAllowedSettingsCategories: () => [
      {
        id: "context",
        label: "Context",
        description: "Memory window and prompt limits",
        icon: HistoryIcon,
      },
    ],
  };
});

vi.mock("../characters/character-avatar", () => ({
  CharacterAvatar: ({ name }: { name: string }) =>
    createElement("span", { "aria-hidden": true }, name[0]),
}));

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const agent = createAgent();
const SEARCH = "Search people, places, chats and actions";

function open(onUrlUpdate?: (event: UrlUpdateEvent) => void) {
  const onOpenChange = vi.fn();
  const Wrapper = withNuqsTestingAdapter({ onUrlUpdate, hasMemory: true });
  render(
    createElement(
      Wrapper as ({ children }: { children: ReactNode }) => ReactNode,
      null,
      createElement(CommandPalette, {
        open: true,
        onOpenChange,
      }),
    ),
  );
  return onOpenChange;
}

function headings() {
  return [
    ...document.querySelectorAll('[data-slot="command-group-label"]'),
  ].map((node) => node.textContent);
}

function type(text: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[data-slot="command-input"]',
  );
  if (!input) throw new Error("No search input");
  fireEvent.change(input, { target: { value: text } });
}

async function run(label: string) {
  const result = await agent.act({
    steps: [{ ref: SEARCH, action: "run", args: [label] }],
  });
  expect(result.error).toBeUndefined();
}

describe("CommandPalette", () => {
  it("suggests your chats, talks going on, who you watch and the sections before typing", () => {
    open();
    expect(headings()).toEqual([
      "Your chats",
      "Happening now",
      "Watching",
      "Go to",
    ]);
    expect(screen.getByText("Talk at Abydos High School")).toBeTruthy();
    expect(screen.getByText("Shiroko Sunaookami")).toBeTruthy();
    expect(screen.getByText("Play as…")).toBeTruthy();
    expect(screen.queryByText("Abydos")).toBeNull();
  });

  it("puts the best match first, with what to do next under it", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    open(onUrlUpdate);
    type("hoshino");

    await waitFor(() => expect(headings()[0]).toBe("Characters"));
    const command = agent.snapshot().find((e) => e.component === "command");
    expect(command?.value).toBe("character:hoshino");
    const labels = (command?.items as { label: string }[]).map(
      (item) => item.label,
    );
    expect(labels).toContain("Message");
    expect(labels).toContain("Abydos High School");
    expect(labels).toContain("Their chats");
    expect(labels).toContain("Timeline");

    await run("action:map:hoshino");
    const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams;
    expect(params?.get("view")).toBe("world");
    expect(params?.get("world.in")).toContain("abydos-high");
    expect(params?.get("sel")).toContain("hoshino");
  });

  it("finds places, groups and settings, and says when nothing matches", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    open(onUrlUpdate);
    type("abydos");
    await waitFor(() => expect(headings()).toContain("Places"));
    expect(screen.getByText("Abydos High School")).toBeTruthy();
    expect(screen.getByText("Wiki page")).toBeTruthy();

    type("task force");
    await waitFor(() => expect(headings()).toContain("Groups"));

    type("context");
    await waitFor(() => expect(screen.getByText("Context")).toBeTruthy());
    await run("Context, Settings");
    const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams;
    expect(params?.get("view")).toBe("settings");
    expect(params?.get("settings.tab")).toBe("context");

    cleanup();
    resetPreferences();
    open();
    type("crimson");
    await waitFor(() =>
      expect(screen.getByText("Crimson & Gold palette")).toBeTruthy(),
    );
    await run("Crimson & Gold palette");
    expect(usePreferencesStore.getState().palette).toBe("crimson");

    cleanup();
    open();
    type("zzqqxx");
    await waitFor(() =>
      expect(screen.getByText("Nothing by that name.")).toBeTruthy(),
    );
    expect(headings()).toEqual([]);
  });

  // ui-sdk's agent swaps an argument matching an item's label for its value,
  // so searching "hoshino" sets the query to the DM's value, "chat:dm-hoshino".
  it.fails(
    "lets an agent search for a name that is also a chat's name",
    async () => {
      open();
      const result = await agent.act({
        steps: [{ ref: SEARCH, action: "setQuery", args: ["hoshino"] }],
      });
      expect(result.error).toBeUndefined();
      await waitFor(() => expect(headings()[0]).toBe("Characters"));
    },
  );
});
