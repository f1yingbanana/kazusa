// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type {
  CharacterSummary,
  Place,
  WikiLintResponse,
  WikiListItem,
  WikiPage,
  WikiReachResponse,
} from "@kazusa/client";
import { createElement, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPlaceIndex } from "@/lib/location/places";
import { createAgent } from "@/ui/agent";
import { PageDetails, PageFacts } from "./page-facts";
import { ReachLine } from "./reach";
import { filterReachEntries } from "./who-knows";
import { WorldPage } from "./world-page";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

const mocks = vi.hoisted(() => ({
  setParams: vi.fn(),
  params: {
    view: "wiki",
    "wiki.page": "hina",
    "wiki.agent": null as string | null,
    "wiki.part": null as string | null,
    "wiki.edit": null as string | null,
    "wiki.raw": null as string | null,
    "wiki.tab": null as string | null,
    "wiki.kind": null as string | null,
    "wiki.name": null as string | null,
    "chars.look": null as string | null,
    "tl.actors": [] as string[],
    "tl.watch": false,
  },
  pageData: undefined as WikiPage | undefined,
  reachData: undefined as WikiReachResponse | undefined,
  lintFindings: [] as WikiLintResponse["findings"],
  characters: [] as CharacterSummary[],
}));

vi.mock("nuqs", () => ({
  parseAsArrayOf: () => ({ withDefault: () => ({}) }),
  parseAsString: { withDefault: () => ({}) },
  parseAsStringLiteral: () => ({ withDefault: () => ({}) }),
  useQueryStates: () => {
    const [state, setState] = useState(mocks.params);
    return [
      state,
      (patch: Partial<typeof mocks.params>, options?: unknown) => {
        mocks.setParams(patch, options);
        setState((prev) => ({ ...prev, ...patch }));
      },
    ];
  },
}));

vi.mock("@/hooks/use-access", () => ({
  useAccess: () => ({ canManage: true, canPlay: false }),
}));

vi.mock("@/hooks/use-characters", () => ({
  isCast: (c: CharacterSummary | undefined) => Boolean(c && !c.isSystemAgent),
  useCharacter: (id: string) => mocks.characters.find((c) => c.id === id),
  useCharacterStatus: () => undefined,
  useCharacters: () => ({
    characters: mocks.characters,
    byId: new Map(mocks.characters.map((c) => [c.id, c])),
  }),
}));

vi.mock("@/hooks/use-selection", () => ({
  useSelection: () => [null, vi.fn()],
}));

vi.mock("@/hooks/use-wiki", () => ({
  useWikiPage: () => ({
    data: mocks.pageData ? { world: mocks.pageData } : undefined,
    isLoading: false,
    error: undefined,
  }),
  useWikiList: () => ({
    data: {
      pages: [
        {
          id: "hina",
          kind: "person",
          name: "Hina",
          aliases: ["Head Prefect"],
          summary: "Chairwoman of the Prefect Team.",
        },
        {
          id: "ako",
          kind: "person",
          name: "Ako",
          aliases: [],
          summary: "",
        },
        {
          id: "iori",
          kind: "person",
          name: "Iori",
          aliases: [],
          summary: "",
        },
        {
          id: "aru",
          kind: "person",
          name: "Aru",
          aliases: [],
          summary: "",
        },
        {
          id: "prefect_hq",
          kind: "concept",
          name: "Prefect HQ",
          aliases: ["Discipline Office"],
          summary: "Headquarters.",
          place: true,
        },
        {
          id: "gehenna",
          kind: "concept",
          name: "Gehenna",
          aliases: [],
          summary: "Academy.",
          place: true,
          group: true,
        },
        {
          id: "prefect_team",
          kind: "concept",
          name: "Prefect Team",
          aliases: [],
          summary: "Student council.",
          group: true,
        },
      ] satisfies WikiListItem[],
    },
  }),
  usePageLookup: () => {
    const map = new Map<string, WikiListItem>([
      [
        "hina",
        {
          id: "hina",
          kind: "person",
          name: "Hina",
          aliases: ["Head Prefect"],
          summary: "",
        },
      ],
      [
        "ako",
        { id: "ako", kind: "person", name: "Ako", aliases: [], summary: "" },
      ],
      [
        "iori",
        { id: "iori", kind: "person", name: "Iori", aliases: [], summary: "" },
      ],
      [
        "aru",
        { id: "aru", kind: "person", name: "Aru", aliases: [], summary: "" },
      ],
      [
        "prefect_hq",
        {
          id: "prefect_hq",
          kind: "concept",
          name: "Prefect HQ",
          aliases: [],
          summary: "",
          place: true,
        },
      ],
      [
        "courtyard",
        {
          id: "courtyard",
          kind: "concept",
          name: "Courtyard",
          aliases: [],
          summary: "",
          place: true,
        },
      ],
      [
        "gehenna",
        {
          id: "gehenna",
          kind: "concept",
          name: "Gehenna",
          aliases: [],
          summary: "",
          place: true,
          group: true,
        },
      ],
      [
        "prefect_team",
        {
          id: "prefect_team",
          kind: "concept",
          name: "Prefect Team",
          aliases: [],
          summary: "",
          group: true,
        },
      ],
    ]);
    return (ref: string) => map.get(ref.toLowerCase());
  },
  usePageName: () => (ref: string) => ref,
  useWikiLint: () => ({
    data: { findings: mocks.lintFindings },
    isLoading: false,
  }),
  useSaveWikiPage: () => vi.fn(),
  useDeleteWikiPage: () => vi.fn(),
}));

vi.mock("@/hooks/use-wiki-editor", () => ({
  useWikiReach: () => ({ data: mocks.reachData, isLoading: false }),
  useWikiCharacter: () => ({
    data: {
      id: "hina",
      name: "Hina",
      memory: { text: "Keep order.", hash: "m1" },
      outfits: {},
      portraits: [],
      stickers: [],
    },
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
  }),
}));

const samplePlaces: Place[] = [
  {
    id: "gehenna",
    name: "Gehenna",
    aliases: [],
    summary: "",
    entryMinutes: 0,
    connections: [],
    bodyMarkdown: "",
  },
  {
    id: "prefect_hq",
    name: "Prefect HQ",
    aliases: ["Discipline Office"],
    parent: "gehenna",
    summary: "",
    entryMinutes: 3,
    connections: [
      {
        to: "courtyard",
        ways: [{ by: "walk", minutes: 2 }],
        note: "only by day",
      },
    ],
    backdrop: "prefect-office",
    bodyMarkdown: "",
  },
  {
    id: "courtyard",
    name: "Courtyard",
    aliases: [],
    parent: "gehenna",
    summary: "",
    entryMinutes: 1,
    connections: [],
    bodyMarkdown: "",
  },
];

vi.mock("@/hooks/use-location", () => ({
  usePlaces: () => buildPlaceIndex(samplePlaces),
  usePlace: (id: string | undefined) =>
    samplePlaces.find((place) => place.id === id),
}));

vi.mock("@/hooks/use-scene", () => ({
  usePortraits: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-clock", () => ({
  useSimNow: () => 0,
}));

vi.mock("@/hooks/use-timeline", () => ({
  useTimeline: () => ({
    events: [],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: undefined,
    loadMore: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-stats", () => ({
  useStats: () => ({ data: undefined }),
  useWornOutfit: () => undefined,
}));

vi.mock("@/lib/source/provider", () => ({
  usePlacesResource: () => ({
    data: {
      places: samplePlaces,
      backdrops: {},
      times: [{ name: "day", from: "06:00" }],
    },
  }),
}));

vi.mock("./refresh", () => ({
  useRefreshWiki: () => vi.fn(),
}));

beforeAll(() => {
  globalThis.__UI_SDK_STRICT__ = true;
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: "[popover] { display: block !important }",
    }),
  );
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
  window.matchMedia ??= () => ({ matches: false }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  mocks.setParams.mockReset();
  mocks.params["wiki.part"] = null;
});

describe("ReachLine", () => {
  it("does not repeat higher-level readers under lower layers in Who reads what", async () => {
    const page: WikiPage = {
      id: "prefect_team",
      kind: "concept",
      name: "Prefect Team",
      aliases: [],
      summary: "Disciplinary committee.",
      lead: "Runs order at Gehenna.",
      sections: [],
      notes: [],
      history: [],
      openThreads: [],
      everyone: "heard of",
      group: true,
    };
    const reach: WikiReachResponse = {
      well: [{ id: "hina", name: "Hina" }],
      knows: [
        { id: "ako", name: "Ako" },
        { id: "iori", name: "Iori" },
      ],
      heard: [{ id: "aru", name: "Aru" }],
      none: 2,
      members: [],
    };

    render(createElement(ReachLine, { page, reach, hasOwn: false }));
    fireEvent.click(screen.getByRole("button"));

    const dialog = await screen.findByRole("dialog", {
      name: "Who reads what",
    });
    const items = within(dialog).getAllByRole("listitem");
    expect(within(items[0]).getByText("Summary")).toBeTruthy();
    expect(within(items[0]).getByText("4 readers")).toBeTruthy();
    expect(within(items[0]).getByText("Aru")).toBeTruthy();
    expect(within(items[0]).queryByText("Hina")).toBeNull();
    expect(within(items[0]).queryByText("Ako")).toBeNull();

    expect(within(items[1]).getByText("Opening")).toBeTruthy();
    expect(within(items[1]).getByText("3 readers")).toBeTruthy();
    expect(within(items[1]).getByText("Ako")).toBeTruthy();
    expect(within(items[1]).getByText("Iori")).toBeTruthy();
    expect(within(items[1]).queryByText("Hina")).toBeNull();

    expect(within(items[2]).getByText("In depth")).toBeTruthy();
    expect(within(items[2]).getByText("1 reader")).toBeTruthy();
    expect(within(items[2]).getByText("Hina")).toBeTruthy();
  });
});

describe("PageFacts", () => {
  it("renders concise at-a-glance facts without backdrop captions or route prose", () => {
    const placePage: WikiPage = {
      id: "prefect_hq",
      kind: "concept",
      name: "Prefect HQ",
      aliases: ["Prefect HQ", "prefect_hq", "Discipline Office"],
      summary: "Headquarters.",
      lead: "Busy office.",
      sections: [],
      notes: [],
      history: [],
      openThreads: [],
      place: true,
      everyone: "heard of",
      known: [{ ref: "prefect_team", level: "close" }],
    };

    const agent = createAgent();
    render(createElement(PageFacts, { page: placePage }));

    expect(screen.getByText("Also known as")).toBeTruthy();
    expect(screen.getByText("prefect_hq, Discipline Office")).toBeTruthy();
    expect(screen.queryByText(/prefect office/i)).toBeNull();
    expect(screen.getByText("Inside")).toBeTruthy();
    expect(screen.getByText("3 min on foot")).toBeTruthy();
    expect(screen.getByText("Ways to")).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 route" })).toBeTruthy();
    expect(screen.queryByText(/only by day/)).toBeNull();
    expect(screen.getByText("Known by")).toBeTruthy();
    expect(screen.getByText("Everyone")).toBeTruthy();
    expect(screen.getByText("Heard of")).toBeTruthy();
    expect(screen.getByText("Knows well")).toBeTruthy();

    const controls = agent.snapshot().filter((entry) => !entry.offPage);
    expect(controls.map((entry) => entry.label)).toContain("On the map");
  });

  it("renders full routes with notes and group member levels in PageDetails on the main page", () => {
    const placePage: WikiPage = {
      id: "prefect_hq",
      kind: "concept",
      name: "Prefect HQ",
      aliases: [],
      summary: "Headquarters.",
      lead: "Busy office.",
      sections: [],
      notes: [],
      history: [],
      openThreads: [],
      place: true,
      group: true,
    };

    render(
      createElement(PageDetails, {
        page: placePage,
        reach: {
          well: [{ id: "hina", name: "Hina" }],
          knows: [{ id: "ako", name: "Ako" }],
          heard: [{ id: "iori", name: "Iori" }],
          none: 0,
          members: [
            { id: "hina", name: "Hina", level: "close" },
            { id: "ako", name: "Ako", level: "knows" },
            { id: "iori", name: "Iori", level: "heard of" },
          ],
        },
      }),
    );
    expect(screen.getByText("Getting around")).toBeTruthy();
    expect(screen.getByText("Courtyard")).toBeTruthy();
    expect(screen.getByText("2 min on foot")).toBeTruthy();
    expect(screen.getByText("only by day")).toBeTruthy();
    const membersSection = screen.getByLabelText("Members");
    expect(within(membersSection).getByText("Close member")).toBeTruthy();
    expect(within(membersSection).getByText("Member")).toBeTruthy();
    expect(within(membersSection).getByText("Associate")).toBeTruthy();
  });

  it("renders Home, Groups, preserved aliases, and Timeline/Their wiki actions for a person page", () => {
    mocks.characters = [
      {
        id: "hina",
        name: "Hina",
        kind: "agent",
        aliases: ["Head Prefect", "hina-sorasaki"],
        groups: ["prefect_team"],
      },
    ];
    const personPage: WikiPage = {
      id: "hina",
      kind: "person",
      name: "Hina",
      aliases: ["Head Prefect", "hina-sorasaki"],
      summary: "Chairwoman.",
      lead: "Leads the Prefect Team.",
      sections: [],
      notes: [],
      history: [],
      openThreads: [],
      home: "prefect_hq",
      in: [{ ref: "prefect_team", level: "close" }],
    };

    render(createElement(PageFacts, { page: personPage }));
    expect(screen.getByText("Also known as")).toBeTruthy();
    expect(screen.getByText("Head Prefect, hina-sorasaki")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Prefect HQ")).toBeTruthy();
    expect(screen.getByText("Groups")).toBeTruthy();
    expect(screen.getByText("Close member")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Their wiki" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Profile" })).toBeNull();
  });
});

describe("WhoKnows lookup filter", () => {
  it("excludes haven't heard while browsing levels, but finds everyone and matches why when searching", () => {
    const entries = [
      {
        id: "natsu",
        name: "Natsu Yutori",
        depth: "well" as const,
        why: "in After-School Sweets Club",
        aliases: [],
        other: undefined,
      },
      {
        id: "ako",
        name: "Ako Amau",
        depth: "knows" as const,
        why: "known directly",
        aliases: [],
        other: undefined,
      },
      {
        id: "mika",
        name: "Mika Misono",
        depth: "none" as const,
        aliases: ["Princess"],
        other: undefined,
      },
    ];

    expect(
      filterReachEntries(entries, { depth: null }).map((e) => e.id),
    ).toEqual(["natsu", "ako"]);
    expect(
      filterReachEntries(entries, { depth: "well" }).map((e) => e.id),
    ).toEqual(["natsu"]);
    expect(
      filterReachEntries(entries, { query: "mika" }).map((e) => e.id),
    ).toEqual(["mika"]);
    expect(
      filterReachEntries(entries, { query: "princess" }).map((e) => e.id),
    ).toEqual(["mika"]);
    expect(
      filterReachEntries(entries, { query: "sweets" }).map((e) => e.id),
    ).toEqual(["natsu"]);
    expect(
      filterReachEntries(entries, { query: "direct" }).map((e) => e.id),
    ).toEqual(["ako"]);
    expect(
      filterReachEntries(
        [
          {
            id: "s1",
            name: "Sweets",
            depth: "well" as const,
            why: "they are in it",
            aliases: [],
            other: undefined,
          },
        ],
        { query: "member" },
      ).map((e) => e.id),
    ).toEqual(["s1"]);
  });
});

describe("WorldPage tabs", () => {
  it("shows Page, Relationships, Looks, and Memory tabs for a cast character", async () => {
    mocks.characters = [
      {
        id: "hina",
        name: "Hina",
        kind: "agent",
        aliases: ["Head Prefect"],
        groups: ["prefect_team"],
      },
    ];
    mocks.pageData = {
      id: "hina",
      kind: "person",
      name: "Hina",
      aliases: ["Head Prefect"],
      summary: "Chairwoman.",
      lead: "Leads the Prefect Team.",
      sections: [],
      notes: [],
      history: [],
      openThreads: [],
      home: "prefect_hq",
      in: [{ ref: "prefect_team", level: "close" }],
    };
    mocks.reachData = {
      well: [{ id: "ako", name: "Ako", why: "in Prefect Team" }],
      knows: [],
      heard: [],
      none: 0,
      members: [],
    };

    const agent = createAgent();
    render(createElement(WorldPage, { id: "hina" }));

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Page", "Relationships", "Looks", "Memory"]);

    const res = await agent.act({
      steps: [{ ref: "Memory", action: "press" }],
    });
    expect(res.error?.message ?? "ok").toBe("ok");
    expect(mocks.setParams).toHaveBeenCalledWith(
      { "wiki.part": "memory", "wiki.edit": null, "wiki.raw": null },
      { history: "replace" },
    );
    expect(await screen.findByText("Keep order.")).toBeTruthy();
  });

  it("shows People tab with cast notes and Who knows for places and concepts", async () => {
    mocks.characters = [
      {
        id: "hina",
        name: "Hina",
        kind: "agent",
        aliases: [],
        groups: ["prefect_team"],
      },
      {
        id: "ako",
        name: "Ako",
        kind: "agent",
        aliases: [],
        groups: ["prefect_team"],
      },
    ];
    mocks.pageData = {
      id: "prefect_hq",
      kind: "concept",
      name: "Prefect HQ",
      aliases: [],
      summary: "Headquarters.",
      lead: "Busy office.",
      sections: [],
      notes: [],
      history: [],
      openThreads: [],
      place: true,
    };
    mocks.reachData = {
      well: [{ id: "hina", name: "Hina", why: "their home" }],
      knows: [{ id: "ako", name: "Ako", why: "in Prefect Team" }],
      heard: [],
      none: 0,
      members: [],
      notes: [
        {
          id: "hina",
          name: "Hina",
          summary: "Quiet late at night.",
          lead: "Quiet late at night when reports settle.",
          relation: "Office",
        },
      ],
    };

    const agent = createAgent();
    render(createElement(WorldPage, { id: "prefect_hq" }));

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Page", "People", "Backdrop"]);

    const res = await agent.act({
      steps: [{ ref: "People", action: "press" }],
    });
    expect(res.error?.message ?? "ok").toBe("ok");
    const notesSection = screen.getByLabelText("What people think");
    expect(within(notesSection).getByText("Hina")).toBeTruthy();
    expect(
      screen.getByText("Quiet late at night when reports settle."),
    ).toBeTruthy();
    expect(screen.getByText("Who knows")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("shows only lint problems for this page inline", () => {
    mocks.lintFindings = [
      {
        level: "error",
        page: "world/hina",
        message: 'link to unknown page "ghost"',
      },
      {
        level: "warning",
        page: "world/ako",
        message: "unrelated warning",
      },
    ];
    render(createElement(WorldPage, { id: "hina" }));
    expect(screen.getByText('link to unknown page "ghost"')).toBeTruthy();
    expect(screen.queryByText("unrelated warning")).toBeNull();
  });
});
