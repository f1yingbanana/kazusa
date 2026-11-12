// @vitest-environment jsdom
import { createElement, useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatMessage,
  PlacesResponse,
  StreamEvent,
  WorldResponse,
} from "@kazusa/client";
import { SourcesProvider } from "../../../../lib/source/provider";
import { RealtimeProvider } from "../../../../lib/live/realtime-provider";
import { useLiveStore } from "../../../../lib/live/state";
import { setClock, useClockStore } from "../../../../lib/live/clock-state";
import { useRealtimeStore } from "../../../../lib/live/realtime-state";
import { useSceneStore } from "../../../../lib/live/scene-state";
import {
  resetPreferences,
  setHuddleRendering,
  usePreferencesStore,
} from "../../../../lib/state/preferences-store";
import {
  fetchChats,
  fetchMessages,
  sendMessage,
  setTyping,
} from "../../../../lib/source/chats/http";
import { useChatDraftStore } from "../../../../lib/state/chat-draft";
import {
  executeClockAction,
  fetchWorld,
} from "../../../../lib/source/clock/http";
import { fetchCharacters } from "../../../../lib/source/characters/http";
import {
  fetchLocations,
  fetchPlaces,
} from "../../../../lib/source/location/http";
import {
  fetchObservedChats,
  fetchObservedMessages,
} from "../../../../lib/source/observe/http";
import { fetchPortraits } from "../../../../lib/source/scene/http";
import type { Chat, ChatInfo } from "../../../../lib/source/chats/types";
import { useChats } from "../../../../hooks/use-chats";
import { useObservedChats } from "../../../../hooks/use-observed-chats";
import { ChatView } from "../chat-view";
import { ObservedChatView } from "../observed-chat-view";
import {
  BACKDROP_POSITION,
  figureScale,
  floorPercent,
} from "../../../../lib/scene/layout";

vi.mock("../../../../lib/source/chats/http", async (original) => ({
  ...(await original<typeof import("../../../../lib/source/chats/http")>()),
  fetchChats: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  setTyping: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../../../../lib/source/clock/http", () => ({
  fetchWorld: vi.fn(),
  executeClockAction: vi.fn(),
}));
vi.mock("../../../../lib/source/characters/http", () => ({
  fetchCharacters: vi.fn(),
}));
vi.mock("../../../../lib/source/location/http", async (original) => ({
  ...(await original<typeof import("../../../../lib/source/location/http")>()),
  fetchLocations: vi.fn(),
  fetchPlaces: vi.fn(),
}));
vi.mock("../../../../lib/source/observe/http", async (original) => ({
  ...(await original<typeof import("../../../../lib/source/observe/http")>()),
  fetchObservedChats: vi.fn(),
  fetchObservedMessages: vi.fn(),
}));
vi.mock("../../../../lib/source/scene/http", async (original) => ({
  ...(await original<typeof import("../../../../lib/source/scene/http")>()),
  fetchPortraits: vi.fn(),
}));
/** Whether the viewer may control the clock (reading mode), per test. */
let canManage = false;
vi.mock("../../../../hooks/use-access", () => ({
  useAccess: () => ({
    canPlay: true,
    canManage,
    isLoading: false,
    isReadOnly: false,
    hasPermission: () => true,
  }),
}));

const PLAYER = "user:you";
const DAY = Date.UTC(2026, 10, 11);
const HOUR = 3_600_000;
/** Wide enough for five figures. */
let width = 1_000;
/** Unmeasured (0) unless a test says: figures are then not capped by width. */
let height = 0;

class TestEventSource extends EventTarget {
  static readonly CLOSED = 2;
  static instances: TestEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor() {
    super();
    TestEventSource.instances.push(this);
  }
  emit(event: StreamEvent): void {
    this.dispatchEvent(
      new MessageEvent(event.type, { data: JSON.stringify(event) }),
    );
  }
}
const stream = (): TestEventSource => {
  const source = TestEventSource.instances.findLast(
    (candidate) => candidate.readyState === 1,
  );
  if (!source) throw new Error("no open stream");
  return source;
};

/** Reports the scene's size as soon as it is observed. */
class TestResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: { width, height },
        } as unknown as ResizeObserverEntry,
      ],
      this,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

const NAMES: Record<string, string> = {
  alice: "Alice",
  bob: "Bob",
  carol: "Carol",
  [PLAYER]: "Player Name",
};
let seq = 0;
const message = (
  senderId: string,
  text: string,
  type?: "action",
): ChatMessage => {
  seq += 1;
  return {
    id: `m${seq}`,
    requestId: `r${seq}`,
    sequence: seq,
    senderId,
    senderName: NAMES[senderId] ?? senderId,
    text,
    timestamp: DAY + 12 * HOUR,
    ...(type ? { type } : {}),
  };
};
const huddle = (members: string[], placeId = "cafe"): Chat => ({
  id: "huddle",
  sessionKey: "chat:huddle:1",
  type: "huddle",
  name: "",
  members,
  placeId,
});
/** The player's chat list says this huddle is as given: members, place. */
const listed = (chat: Chat) =>
  vi.mocked(fetchChats).mockResolvedValue({
    user: { id: PLAYER, name: "Player Name" },
    chats: [chat],
  });
/** A character with portraits, by id. */
const drawn = (id: string) => ({
  id,
  name: NAMES[id] ?? id.toUpperCase(),
  kind: "agent" as const,
  aliases: [],
  portraitUrl: `/kazusa/portrait?id=${id}&name=neutral&v=1`,
});
const world: WorldResponse = {
  user: { id: PLAYER, name: "Player Name" },
  serverNow: Date.now(),
  clock: { simTime: DAY + 12 * HOUR, speed: 0, updatedAt: Date.now() },
  world: { title: "Test world" },
  capabilities: {
    characters: "live",
    status: "live",
    chats: "live",
    places: "live",
    location: "live",
    clock: "live",
    observe: "live",
    scene: "live",
  },
};
const place = (id: string, name: string, backdrop?: string) => ({
  id,
  name,
  aliases: [],
  summary: "",
  entryMinutes: 0,
  connections: [],
  bodyMarkdown: "",
  ...(backdrop ? { backdrop } : {}),
});
const PLACES: PlacesResponse = {
  places: [place("cafe", "Cafe", "cafe"), place("street", "Street")],
  backdrops: {
    cafe: { files: [{ name: "day", url: "/b/cafe-day", time: "day" }] },
  },
  times: [{ name: "day", from: "06:00" }],
};

/** The chat list reads the Chats view keeps mounted: they carry members. */
function ListReads({ children }: { children: ReactNode }) {
  useChats();
  useObservedChats();
  return children;
}

function renderWith(
  ui: ReactNode,
  searchParams = "",
): ReturnType<typeof render> & { urls: URLSearchParams[] } {
  const urls: URLSearchParams[] = [];
  const Nuqs = withNuqsTestingAdapter({
    searchParams,
    hasMemory: true,
    onUrlUpdate: (event) => urls.push(event.searchParams),
  });
  const result = render(
    createElement(
      Nuqs,
      null,
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => new Map(),
            dedupingInterval: 0,
            errorRetryCount: 0,
          },
        },
        createElement(SourcesProvider, {
          fallback: null,
          children: createElement(RealtimeProvider, {
            children: createElement(ListReads, null, ui),
          }),
        }),
      ),
    ),
  );
  return Object.assign(result, { urls });
}

const chatView = (chat: Chat) =>
  createElement(ChatView, { chat, onBack: vi.fn(), onSent: vi.fn() });

const scene = () => screen.queryByRole("region", { name: /^Scene at/ });
const figureIds = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-figure]")].map(
    (element) => element.dataset.figure,
  );
const figure = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-figure="${id}"]`);
/**
 * An animation ending. jsdom has no AnimationEvent, so React listens under the
 * prefixed name: send both.
 */
const endAnimation = (element: HTMLElement) =>
  act(() => {
    element.dispatchEvent(new Event("animationend", { bubbles: true }));
    element.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
  });
const draft = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" }).value;
const lines = () =>
  [...screen.getByRole("log").querySelectorAll("[data-line]")].map(
    (line) => line.textContent,
  );
/** The earlier lines above the panel, oldest first. */
const echoes = () =>
  [...document.querySelectorAll("[data-echo]")].map((echo) => echo.textContent);
const plate = () => document.querySelector("[data-plate]")?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  width = 1_000;
  height = 0;
  canManage = false;
  window.localStorage.clear();
  resetPreferences();
  TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  useLiveStore.setState(useLiveStore.getInitialState(), true);
  useClockStore.setState(useClockStore.getInitialState(), true);
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSceneStore.setState(useSceneStore.getInitialState(), true);
  useChatDraftStore.setState(useChatDraftStore.getInitialState(), true);
  vi.mocked(fetchWorld).mockResolvedValue(world);
  // Bob has no portraits.
  vi.mocked(fetchCharacters).mockResolvedValue([
    drawn("alice"),
    { id: "bob", name: "Bob", kind: "agent", aliases: [] },
    ...["carol", "dave", "erin", "fay"].map(drawn),
  ]);
  vi.mocked(fetchChats).mockResolvedValue({
    user: { id: PLAYER, name: "Player Name" },
    chats: [huddle([PLAYER, "alice", "bob"])],
  });
  vi.mocked(fetchMessages).mockResolvedValue({ messages: [], hasMore: false });
  vi.mocked(fetchObservedChats).mockResolvedValue({ chats: [] });
  vi.mocked(fetchObservedMessages).mockResolvedValue({
    messages: [],
    hasMore: false,
  });
  vi.mocked(fetchPlaces).mockResolvedValue(PLACES);
  vi.mocked(fetchLocations).mockResolvedValue({ records: {} });
  vi.mocked(fetchPortraits).mockResolvedValue({
    portraits: [
      { name: "neutral", url: "/p/alice-neutral", mood: "neutral" },
      { name: "happy", url: "/p/alice-happy", mood: "happy" },
    ],
    default: "neutral",
    size: [400, 800],
    eyeline: 0.12,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Scene or Transcript", () => {
  it("opens a huddle as a scene, and the link or the preference can say otherwise", async () => {
    const chat = huddle([PLAYER, "alice", "bob"]);
    const first = renderWith(chatView(chat));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(
      screen.getByRole("button", { name: "Scene", pressed: true }),
    ).toBeDefined();
    first.unmount();

    renderWith(chatView(chat), "?chats.as=list");
    await screen.findByRole("button", { name: "Transcript", pressed: true });
    expect(scene()).toBeNull();
    cleanup();

    setHuddleRendering("list");
    renderWith(chatView(chat));
    await screen.findByRole("button", { name: "Transcript", pressed: true });
    expect(scene()).toBeNull();
    cleanup();

    // The link wins over the preference.
    renderWith(chatView(chat), "?chats.as=scene");
    await waitFor(() => expect(scene()).not.toBeNull());
  });

  it("opens as a scene at once on a reload, drawing nobody until the roster says who has portraits", async () => {
    const places = await fetchPlaces();
    const roster = await fetchCharacters();
    let placesArrive: (value: typeof places) => void = () => {};
    let rosterArrive: (value: typeof roster) => void = () => {};
    vi.mocked(fetchPlaces).mockImplementation(
      () => new Promise((resolve) => (placesArrive = resolve)),
    );
    vi.mocked(fetchCharacters).mockImplementation(
      () => new Promise((resolve) => (rosterArrive = resolve)),
    );
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [message("alice", "Already said.")],
      hasMore: false,
    });
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"])),
    );
    // The scene from the first paint: no transcript first, no switch unpressed.
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(
      screen.getByRole("button", { name: "Scene", pressed: true }),
    ).toBeDefined();
    await waitFor(() => expect(lines()).toEqual(["Alice: Already said."]));
    // Who can be drawn isn't known: nobody, no card, no place kept.
    expect(figureIds(container)).toEqual([]);
    expect(container.querySelector('[data-backdrop="none"]')).not.toBeNull();

    await act(async () => {
      rosterArrive(roster);
      placesArrive(places);
    });
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]));
    expect(figure(container, "alice")?.dataset.presence).toBe("entering");
    await waitFor(() =>
      expect(container.querySelector('[data-backdrop="/b/cafe-day"]')).not.toBe(
        null,
      ),
    );
  });

  it("opens a huddle without any art as a scene too; a text chat and a draft huddle stay on the transcript", async () => {
    // Nobody with portraits, and a place without a backdrop.
    listed(huddle([PLAYER, "bob"], "street"));
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [message("bob", "Anyone there?")],
      hasMore: false,
    });
    const { container } = renderWith(
      chatView(huddle([PLAYER, "bob"], "street")),
    );
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(
      screen.getByRole("button", { name: "Scene", pressed: true }),
    ).toBeDefined();
    await waitFor(() => expect(lines()).toEqual(["Bob: Anyone there?"]));
    expect(container.querySelector("[data-plate]")?.textContent).toBe("Bob");
    expect(figureIds(container)).toEqual([]);
    cleanup();

    const group: Chat = {
      id: "group",
      sessionKey: "chat:group:1",
      type: "group",
      name: "Club",
      members: [PLAYER, "alice"],
    };
    renderWith(chatView(group), "?chats.as=scene");
    await screen.findByRole("textbox", { name: "Message" });
    expect(screen.queryByRole("group", { name: "Show as" })).toBeNull();
    expect(scene()).toBeNull();
    cleanup();

    renderWith(
      chatView({ ...huddle([PLAYER, "alice"]), id: "draft", draft: true }),
      "?chats.as=scene",
    );
    await screen.findByRole("textbox", { name: "Message" });
    expect(screen.queryByRole("group", { name: "Show as" })).toBeNull();
    expect(scene()).toBeNull();
  });

  it("switches without losing the composer's draft, writing the link and the preference", async () => {
    const view = renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Half a thought" } });

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await waitFor(() => expect(scene()).toBeNull());
    expect(usePreferencesStore.getState().huddleRendering).toBe("list");
    expect(view.urls.at(-1)?.get("chats.as")).toBe("list");
    expect(draft()).toBe("Half a thought");

    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(view.urls.at(-1)?.get("chats.as")).toBe("scene");
    expect(draft()).toBe("Half a thought");
  });

  it("opens someone else's huddle as a scene from a link, read-only", async () => {
    const theirs: ChatInfo = { ...huddle(["alice", "carol"]), id: "theirs" };
    vi.mocked(fetchObservedChats).mockResolvedValue({
      chats: [theirs],
    });
    const { container } = renderWith(
      createElement(ObservedChatView, { chat: theirs, onBack: vi.fn() }),
      "?chats.id=theirs&chats.as=scene",
    );
    await waitFor(() =>
      expect(figureIds(container).sort()).toEqual(["alice", "carol"]),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("the scene", () => {
  it("draws a figure for everyone with portraits but the player, fetching portraits for them alone", async () => {
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"])),
    );
    // Bob has none: no figure, no card, no place kept (Alice in the middle).
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]));
    expect(figure(container, "alice")?.style.left).toBe("50%");
    await screen.findByRole("img", { name: "Alice" });
    expect(container.querySelector('[data-backdrop="/b/cafe-day"]')).not.toBe(
      null,
    );
    // Cropped by cover about one anchor, never letterboxed or stretched.
    const picture = container.querySelector<HTMLImageElement>(
      '[data-backdrop] img[src="/b/cafe-day"]',
    );
    expect(picture?.className).toContain("object-cover");
    expect(picture?.style.objectPosition).toBe(BACKDROP_POSITION);
    // Carol has portraits but isn't here; Bob isn't fetched without any.
    expect(vi.mocked(fetchPortraits).mock.calls).toEqual([["alice"]]);
  });

  it("lights the speaker of the panel's line by brightness alone, shows a line as it is said, and narrates an action without a name plate", async () => {
    listed(huddle([PLAYER, "alice", "carol"]));
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "carol"])),
    );
    await waitFor(() => expect(figureIds(container)).toHaveLength(2));
    await screen.findByRole("img", { name: "Alice" });
    const alice = figure(container, "alice");
    const place = (element: HTMLElement | null) =>
      [element?.style.left, element?.style.bottom, element?.className].join(
        " ",
      );
    const before = place(alice);
    // Nothing said yet: nobody is dimmed.
    expect(figure(container, "alice")?.dataset.lit).toBe("none");
    // Saying "You are late, again." across a second of sim time; the clock is
    // paused halfway through it.
    const now = DAY + 12 * HOUR;
    act(() =>
      stream().emit({
        type: "typing",
        chatId: "huddle",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "speaking",
        speech: {
          text: "You are late, again.",
          from: now - 500,
          until: now + 500,
        },
      }),
    );
    // Her line is the panel's: she is lit from its start.
    expect(figure(container, "alice")?.dataset.lit).toBe("true");
    expect(figure(container, "carol")?.dataset.lit).toBe("false");
    // The same element, in the same place and size; only its picture is
    // brighter, and nothing is scaled.
    expect(figure(container, "alice")).toBe(alice);
    expect(place(alice)).toBe(before);
    const picture = screen.getByRole("img", { name: "Alice" });
    expect(picture.className).not.toMatch(/scale/);
    expect(picture.className).not.toMatch(/brightness/);
    expect(screen.getByRole("img", { name: "Carol" }).className).toMatch(
      /brightness-/,
    );
    // Her line as it is said: letter by letter, ahead of the saying (the
    // paused clock holds it halfway through being said, further through
    // being typed), the whole line for a screen reader, no dots.
    expect(plate()).toBe("Alice");
    const saying = screen.getByRole("log").querySelector("[data-saying]");
    expect(saying?.querySelector("[aria-hidden]")?.textContent).toBe(
      "You are late, ",
    );
    expect(saying?.querySelector(".sr-only:last-child")?.textContent).toBe(
      "You are late, again.",
    );
    expect(screen.getByRole("log").querySelector("[data-dots]")).toBeNull();

    // An action done meanwhile waits for her line to be said.
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("carol", "sets the bag down.", "action"),
      }),
    );
    expect(plate()).toBe("Alice");
    expect(figure(container, "alice")?.dataset.lit).toBe("true");
    // Her line lands in place, as said; she stays lit.
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "You are late, again."),
      }),
    );
    expect(lines()).toEqual(["Alice: You are late, again."]);
    expect(figure(container, "alice")?.dataset.lit).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: "1 behind · Jump to live" }),
    );
    // An action has no plate: narrated, never under someone's name; its doer
    // is lit as long as it is the panel's line.
    expect(lines()).toEqual(["Carol sets the bag down."]);
    expect(plate()).toBeUndefined();
    expect(echoes()).toEqual(["AliceYou are late, again."]);
    expect(figure(container, "carol")?.dataset.lit).toBe("true");
    expect(figure(container, "alice")?.dataset.lit).toBe("false");
  });

  it("changes a figure's face as its line starts, keeps it, and shows the neutral one for a face it has no picture of", async () => {
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"])),
    );
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]));
    const picture = () =>
      figure(container, "alice")?.querySelector("img")?.getAttribute("src");
    await screen.findByRole("img", { name: "Alice" });
    expect(picture()).toBe("/p/alice-neutral");
    const now = DAY + 12 * HOUR;
    act(() =>
      stream().emit({
        type: "typing",
        chatId: "huddle",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "speaking",
        speech: {
          text: "Finally!",
          face: { name: "happy" },
          from: now,
          until: now + 1_000,
        },
      }),
    );
    // Smiling as she starts to say it, on the same figure.
    expect(screen.getByRole("img", { name: "Alice, happy" })).toBe(
      figure(container, "alice")?.querySelector("img"),
    );
    expect(picture()).toBe("/p/alice-happy");
    // Her next line without a face keeps it.
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: { ...message("alice", "Finally!"), face: { name: "happy" } },
      }),
    );
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "shrugs.", "action"),
      }),
    );
    expect(picture()).toBe("/p/alice-happy");
    // A face her set has no picture of: her neutral one.
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: { ...message("alice", "Hmph."), face: { name: "annoyed" } },
      }),
    );
    expect(picture()).toBe("/p/alice-neutral");
    expect(screen.getByRole("img", { name: "Alice" })).toBeTruthy();
  });

  it("shows the lines of someone without portraits under their name, drawing nobody for them", async () => {
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"])),
    );
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]));
    act(() => {
      stream().emit({
        type: "typing",
        chatId: "huddle",
        senderId: "bob",
        senderName: "Bob",
        isTyping: true,
        mode: "speaking",
      });
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("bob", "Over here."),
      });
    });
    expect(container.querySelector("[data-plate]")?.textContent).toBe("Bob");
    expect(lines()).toEqual(["Bob: Over here."]);
    expect(figureIds(container)).toEqual(["alice"]);
    expect(figure(container, "alice")?.style.left).toBe("50%");
  });

  it("stands figures balanced about the middle and slides them, not anew, when someone joins", async () => {
    listed(huddle([PLAYER, "alice", "carol"]));
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "carol"])),
    );
    await waitFor(() => expect(figureIds(container)).toHaveLength(2));
    await screen.findByRole("img", { name: "Carol" });
    const lefts = () =>
      Object.fromEntries(
        [...container.querySelectorAll<HTMLElement>("[data-figure]")]
          .filter((element) => element.dataset.presence !== "leaving")
          .map((element) => [element.dataset.figure, element.style.left]),
      );
    expect(lefts()).toEqual({ alice: "30%", carol: "70%" });
    const alice = figure(container, "alice");
    expect(alice?.className).toContain("transition-[left]");
    listed(huddle([PLAYER, "alice", "carol", "dave"]));
    await act(async () => stream().emit({ type: "chats" }));
    // Dave joins at the left end; Alice moves to the middle.
    await waitFor(() =>
      expect(lefts()).toEqual({ dave: "30%", alice: "50%", carol: "70%" }),
    );
    expect(figure(container, "alice")).toBe(alice);
    listed(huddle([PLAYER, "alice", "carol", "dave", "erin", "fay"]));
    await act(async () => stream().emit({ type: "chats" }));
    await waitFor(() =>
      expect(lefts()).toEqual({
        fay: "10%",
        dave: "30%",
        alice: "50%",
        carol: "70%",
        erin: "90%",
      }),
    );
  });

  it("draws a figure whose portraits come late as a new element, not the placeholder moved into place", async () => {
    let arrive: (
      set: Awaited<ReturnType<typeof fetchPortraits>>,
    ) => void = () => {};
    vi.mocked(fetchPortraits).mockImplementation(
      () => new Promise((resolve) => (arrive = resolve)),
    );
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"])),
    );
    await waitFor(() => expect(figure(container, "alice")).not.toBeNull());
    const placeholder = figure(container, "alice");
    expect(placeholder?.querySelector("img")).toBeNull();
    await act(async () =>
      arrive({
        portraits: [{ name: "neutral", url: "/p/alice", mood: "neutral" }],
        default: "neutral",
        eyeline: 0.12,
      }),
    );
    await screen.findByRole("img", { name: "Alice" });
    // Reusing the placeholder's element would let its transition carry it
    // sideways and up from where the placeholder stood.
    expect(figure(container, "alice")).not.toBe(placeholder);
  });

  it("lets someone who walks off fade out and then removes them", async () => {
    listed(huddle([PLAYER, "alice", "carol"]));
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "carol"])),
    );
    await waitFor(() => expect(figureIds(container)).toHaveLength(2));
    listed(huddle([PLAYER, "alice"]));
    await act(async () => stream().emit({ type: "chats" }));
    await waitFor(() =>
      expect(figure(container, "carol")?.dataset.presence).toBe("leaving"),
    );
    // Alice, still here, closes up to the middle as Carol walks off.
    expect(figure(container, "alice")?.style.left).toBe("50%");
    const leaving = figure(container, "carol");
    if (!leaving) throw new Error("Carol is not drawn");
    endAnimation(leaving);
    expect(figureIds(container)).toEqual(["alice"]);
  });

  it("settles a walk that never reports its end", async () => {
    listed(huddle([PLAYER, "alice", "carol"]));
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "carol"])),
    );
    await waitFor(() => expect(figureIds(container)).toHaveLength(2));
    listed(huddle([PLAYER, "alice"]));
    await act(async () => stream().emit({ type: "chats" }));
    await waitFor(() =>
      expect(figure(container, "carol")?.dataset.presence).toBe("leaving"),
    );
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]), {
      timeout: 2_000,
    });
  });

  it("draws a place without a backdrop as a darkened surface, unnamed, with those who have portraits in front", async () => {
    listed(huddle([PLAYER, "alice", "bob"], "street"));
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"], "street")),
    );
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]));
    await screen.findByRole("img", { name: "Alice" });
    const surface = container.querySelector<HTMLElement>(
      '[data-backdrop="none"]',
    );
    // No picture and no big name (the header names the place): a flat tint of
    // the foreground over the app's own background.
    expect(surface?.textContent).toBe("");
    expect(surface?.querySelector("img")).toBeNull();
    expect(surface?.className).toMatch(/\bbg-foreground\/\[0\.06\]/);
    expect(scene()?.className).not.toMatch(/\bbg-/);
  });

  it("keeps the old backdrop until the new hour's picture has arrived, then fades it in", async () => {
    vi.mocked(fetchPlaces).mockResolvedValue({
      ...PLACES,
      backdrops: {
        cafe: {
          files: [
            { name: "day", url: "/b/cafe-day", time: "day" },
            { name: "night", url: "/b/cafe-night", time: "night" },
          ],
        },
      },
      times: [
        { name: "day", from: "06:00" },
        { name: "night", from: "19:00" },
      ],
    });
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob"])),
    );
    await waitFor(() =>
      expect(container.querySelector('[data-backdrop="/b/cafe-day"]')).not.toBe(
        null,
      ),
    );
    act(() => {
      const clock = useClockStore.getState().clock;
      if (clock)
        setClock({
          ...clock,
          clock: { ...clock.clock, simTime: DAY + 20 * HOUR },
        });
    });
    const picture = (url: string) =>
      container.querySelector<HTMLImageElement>(
        `[data-backdrop] img[src="${url}"]`,
      );
    const night = picture("/b/cafe-night");
    if (!night) throw new Error("the night picture is not drawn");
    // Still on its way: hidden, and the day stays under it.
    expect(night.className).toContain("opacity-0");
    expect(night.className).not.toContain("animate-in");
    expect(picture("/b/cafe-day")).not.toBeNull();

    act(() => {
      night.dispatchEvent(new Event("load"));
    });
    expect(night.className).toContain("animate-in");
    expect(picture("/b/cafe-day")).not.toBeNull();
    endAnimation(night);
    expect(picture("/b/cafe-day")).toBeNull();
  });

  it("says nobody has spoken only once the history has been read", async () => {
    let arrive: (
      page: Awaited<ReturnType<typeof fetchMessages>>,
    ) => void = () => {};
    vi.mocked(fetchMessages).mockImplementation(
      () => new Promise((resolve) => (arrive = resolve)),
    );
    renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(screen.queryByText("Nobody has said anything yet.")).toBeNull();
    await act(async () =>
      arrive({ messages: [message("alice", "Hello.")], hasMore: false }),
    );
    await waitFor(() => expect(lines()).toEqual(["Alice: Hello."]));
    expect(screen.queryByText("Nobody has said anything yet.")).toBeNull();
  });

  it("holds lines that come too fast, and Jump to live shows them", async () => {
    renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    await screen.findByText("Nobody has said anything yet.");
    act(() => {
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "First, and it takes a while to read."),
      });
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "Second."),
      });
    });
    expect(lines()).toEqual(["Alice: First, and it takes a while to read."]);
    fireEvent.click(
      screen.getByRole("button", { name: "1 behind · Jump to live" }),
    );
    expect(lines()).toEqual(["Alice: Second."]);
    expect(screen.queryByRole("button", { name: /behind/ })).toBeNull();
  });

  it("reads a new line from its start when it doesn't fit the panel", async () => {
    renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await screen.findByText("Nobody has said anything yet.");
    const log = screen.getByRole("log");
    const scrolled = vi.fn();
    Object.defineProperty(log, "scrollHeight", { get: () => 480 });
    Object.defineProperty(log, "scrollTop", { get: () => 120, set: scrolled });
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "A line long enough to need the room."),
      }),
    );
    expect(scrolled).toHaveBeenLastCalledWith(0);
  });

  it("shows a held line by itself once the one on screen has been read", async () => {
    renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await screen.findByText("Nobody has said anything yet.");
    act(() => {
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "Short one."),
      });
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "Then this."),
      });
    });
    expect(lines()).toEqual(["Alice: Short one."]);
    await waitFor(() => expect(lines()).toEqual(["Alice: Then this."]), {
      timeout: 3_000,
    });
  });

  it("shows one figure on an upright phone, from the chest up, whoever said the newest line", async () => {
    width = 375;
    height = 560;
    listed(huddle([PLAYER, "alice", "bob", "carol"]));
    const { container } = renderWith(
      chatView(huddle([PLAYER, "alice", "bob", "carol"])),
    );
    await waitFor(() => expect(scene()?.dataset.slots).toBe("1"));
    await waitFor(() => expect(figureIds(container)).toEqual(["alice"]));
    await screen.findByRole("img", { name: "Alice" });
    const alice = figure(container, "alice");
    expect(alice?.style.left).toBe("50%");
    // The bust framing: the scene's one scale for it, on its lower floor,
    // cut at the chest by the scene's foot; the picture at its own size.
    expect(alice?.style.top).toBe(`${floorPercent("bust")}%`);
    const picture = screen.getByRole("img", { name: "Alice" });
    expect(Number(picture.style.zoom)).toBeCloseTo(figureScale(560, "bust"));
    expect(picture.style.height).toBe("");

    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("carol", "Me next."),
      }),
    );
    // Carol takes the one place; Alice fades out in it.
    expect(figure(container, "carol")?.dataset.presence).toBe("entering");
    expect(figure(container, "carol")?.style.left).toBe("50%");
    expect(figure(container, "alice")?.dataset.presence).toBe("leaving");
    // Bob, without portraits, never takes it.
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("bob", "And me."),
      }),
    );
    expect(figure(container, "bob")).toBeNull();
    expect(figure(container, "carol")?.dataset.presence).not.toBe("leaving");
  });
});

describe("full screen", () => {
  const stage = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-fullscreen]");
  /** As a click does in a browser: focus on the button, then the click. */
  const enter = () => {
    const button = screen.getByRole("button", { name: "Full screen" });
    button.focus();
    fireEvent.click(button);
  };
  const exitButton = () =>
    screen.queryByRole("button", { name: "Exit full screen" });

  /** A browser with the Fullscreen API, which can say no. */
  function browserApi(refuse = false) {
    let current: Element | null = null;
    const change = () => document.dispatchEvent(new Event("fullscreenchange"));
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: true,
    });
    const request = vi.fn(function (this: Element) {
      if (refuse) return Promise.reject(new TypeError("Permissions check"));
      current = document.querySelector("[data-fullscreen]");
      change();
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      current = null;
      change();
      return Promise.resolve();
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: request,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exit,
    });
    return {
      request,
      exit,
      /** The browser leaves on its own: Escape, the system's gesture. */
      leave: () => {
        current = null;
        change();
      },
    };
  }
  afterEach(() => {
    for (const key of [
      "fullscreenElement",
      "fullscreenEnabled",
      "exitFullscreen",
    ] as const)
      Reflect.deleteProperty(document, key);
    Reflect.deleteProperty(Element.prototype, "requestFullscreen");
  });

  it("uses the browser's full screen for scene and composer, leaving by the button or by the browser", async () => {
    const api = browserApi();
    const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(stage(container)?.dataset.fullscreen).toBe("off");
    expect(exitButton()).toBeNull();

    await act(async () => enter());
    const element = stage(container);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request.mock.contexts[0]).toBe(element);
    expect(element?.dataset.fullscreen).toBe("browser");
    // What is full screen: the scene, the composer, the way out, the time.
    expect(element?.contains(scene())).toBe(true);
    expect(element?.querySelector("textarea")).not.toBeNull();
    expect(document.activeElement).toBe(exitButton());
    // An icon, named but without words of its own.
    expect(
      [...(exitButton()?.childNodes ?? [])]
        .filter(
          (node) => !(node instanceof HTMLElement && node.matches(".sr-only")),
        )
        .map((node) => node.textContent)
        .join(""),
    ).toBe("");
    expect(within(element as HTMLElement).getByText("12:00")).toBeDefined();

    await act(async () => fireEvent.click(exitButton() as HTMLElement));
    expect(api.exit).toHaveBeenCalledTimes(1);
    expect(element?.dataset.fullscreen).toBe("off");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Full screen" }),
    );

    // Escape or the system's gesture: the browser leaves, the view follows.
    await act(async () => enter());
    expect(element?.dataset.fullscreen).toBe("browser");
    act(() => api.leave());
    expect(element?.dataset.fullscreen).toBe("off");
    expect(exitButton()).toBeNull();
  });

  it.each<[string, () => void]>([
    ["has no Fullscreen API (an iPhone)", () => {}],
    ["refuses", () => browserApi(true)],
  ])(
    "lays the stage over the whole window when the browser %s, and Escape leaves",
    async (_, setUp) => {
      setUp();
      const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
      await waitFor(() => expect(scene()).not.toBeNull());
      await act(async () => enter());
      const element = stage(container);
      expect(element?.dataset.fullscreen).toBe("window");
      expect(element?.className).toMatch(/\bfixed\b/);
      expect(element?.className).toMatch(/\binset-0\b/);
      expect(exitButton()).not.toBeNull();
      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
      });
      expect(element?.dataset.fullscreen).toBe("off");
      expect(element?.className).not.toMatch(/\bfixed\b/);
    },
  );

  it("keeps the composer's draft and focus going in and out", async () => {
    const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    const box = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message",
    });
    fireEvent.change(box, { target: { value: "Half a thought" } });
    await act(async () => enter());
    expect(stage(container)?.dataset.fullscreen).toBe("window");
    // The same element: nothing was remounted.
    expect(screen.getByRole("textbox", { name: "Message" })).toBe(box);
    expect(draft()).toBe("Half a thought");
    box.focus();
    act(() => {
      fireEvent.keyDown(box, { key: "Escape" });
    });
    expect(stage(container)?.dataset.fullscreen).toBe("off");
    expect(screen.getByRole("textbox", { name: "Message" })).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(draft()).toBe("Half a thought");
  });

  it("is offered only while the scene shows, and switching to the transcript leaves it", async () => {
    const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    await act(async () => enter());
    expect(stage(container)?.dataset.fullscreen).toBe("window");
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await waitFor(() => expect(scene()).toBeNull());
    expect(stage(container)?.dataset.fullscreen).toBe("off");
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    // Back on the scene, it is not full screen by itself.
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(stage(container)?.dataset.fullscreen).toBe("off");
  });

  it.each([
    [false, "only the time"],
    [true, "the top bar's clock controls beside the time"],
  ])("shows a viewer who may control the clock (%s) %s", async (manager) => {
    canManage = manager;
    const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    await act(async () => enter());
    const stage = within(
      container.querySelector("[data-fullscreen]") as HTMLElement,
    );
    await stage.findByText("12:00");
    const controls = stage.queryByRole("group", {
      name: "Simulation speed",
    });
    expect(controls !== null).toBe(manager);
    expect(stage.queryAllByRole("button", { name: "10×" })).toHaveLength(
      manager ? 1 : 0,
    );
  });

  it("leaves the browser's full screen when the chat closes", async () => {
    const api = browserApi();
    const view = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    await act(async () => enter());
    expect(stage(view.container)?.dataset.fullscreen).toBe("browser");
    view.unmount();
    expect(api.exit).toHaveBeenCalledTimes(1);
  });

  it("shows someone else's huddle full screen without a composer, and leaves when it ends", async () => {
    const theirs: ChatInfo = { ...huddle(["alice", "carol"]), id: "theirs" };
    vi.mocked(fetchObservedChats).mockResolvedValue({ chats: [theirs] });
    let end: () => void = () => {};
    function Observed() {
      const [ended, setEnded] = useState(false);
      end = () => setEnded(true);
      return createElement(ObservedChatView, {
        chat: { ...theirs, ended },
        onBack: vi.fn(),
      });
    }
    const { container } = renderWith(
      createElement(Observed),
      "?chats.id=theirs",
    );
    await waitFor(() => expect(scene()).not.toBeNull());
    await act(async () => enter());
    const element = stage(container);
    expect(element?.dataset.fullscreen).toBe("window");
    expect(element?.querySelector("textarea")).toBeNull();
    expect(element?.textContent).toContain("Observing, read-only");
    act(() => end());
    // The same stage, no longer full screen, and not offered again.
    expect(stage(container)).toBe(element);
    expect(element?.dataset.fullscreen).toBe("off");
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  });
});

describe("the dock", () => {
  const inScene = () => {
    const region = scene();
    if (!region) throw new Error("no scene");
    return within(region);
  };

  it("puts every scene-only control left of Scene | Transcript, so the switch stays put", async () => {
    renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    const fullscreen = screen.getByRole("button", { name: "Full screen" });
    const show = screen.getByRole("group", { name: "Show as" });
    expect(fullscreen.parentElement).toBe(show.parentElement);
    expect(
      fullscreen.compareDocumentPosition(show) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is the reply box inside the scene's panel, sharing the transcript's draft both ways", async () => {
    renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    // In the scene, in its panel; nothing below the scene, no mode switch.
    const box = inScene().getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message",
    });
    expect(box.closest("[data-panel]")).not.toBeNull();
    expect(box.placeholder).toBe("Say something, or *do something*");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    // Wrapped in asterisks, the draft reads as the action it will be.
    fireEvent.change(box, { target: { value: "*waves*" } });
    expect(box.className).toContain("italic");
    expect(
      inScene().getByRole("button", { name: "Send action" }),
    ).toBeDefined();
    fireEvent.change(box, { target: { value: "I *really* mean it" } });
    expect(box.className).not.toContain("italic");
    fireEvent.change(box, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await waitFor(() => expect(scene()).toBeNull());
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "From the transcript" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scene" }));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(draft()).toBe("From the transcript");
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "From the scene" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await waitFor(() => expect(scene()).toBeNull());
    expect(draft()).toBe("From the scene");
  });

  it("sends with Enter as the transcript does, signalling typing, and shows the line under the player's name", async () => {
    vi.mocked(sendMessage).mockImplementation(async (payload) => ({
      chatId: "huddle",
      sessionKey: "chat:huddle:1",
      status: "delivered",
      message: {
        ...message(PLAYER, payload.text),
        requestId: payload.requestId,
        senderName: "Player Name",
      },
    }));
    renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    const box = inScene().getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Count me in." } });
    expect(vi.mocked(setTyping)).toHaveBeenLastCalledWith({
      sessionKey: "chat:huddle:1",
      isTyping: true,
    });
    // Shift+Enter is a new line, not a send.
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(vi.mocked(sendMessage).mock.calls[0]?.[0]).toMatchObject({
      text: "Count me in.",
      sessionKey: "chat:huddle:1",
    });
    expect(vi.mocked(setTyping)).toHaveBeenLastCalledWith({
      sessionKey: "chat:huddle:1",
      isTyping: false,
    });
    expect(draft()).toBe("");
    await waitFor(() => expect(lines()).toEqual(["Player Name: Count me in."]));
    expect(plate()).toBe("Player Name");
  });

  it("sends a message wrapped in asterisks as an action, without them", async () => {
    vi.mocked(sendMessage).mockImplementation(async (payload) => ({
      chatId: "huddle",
      sessionKey: "chat:huddle:1",
      status: "delivered",
      message: {
        ...message(
          PLAYER,
          payload.text,
          payload.type === "action" ? "action" : undefined,
        ),
        requestId: payload.requestId,
        senderName: "Player Name",
      },
    }));
    renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    const box = inScene().getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "  **waves at Alice**  " } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(vi.mocked(sendMessage).mock.calls[0]?.[0]).toMatchObject({
      text: "waves at Alice",
      type: "action",
    });
    await waitFor(() =>
      expect(lines()).toEqual(["Player Name waves at Alice"]),
    );
    // A text chat reads nothing into asterisks.
    cleanup();
    vi.mocked(sendMessage).mockClear();
    const group: Chat = {
      id: "group",
      sessionKey: "chat:group:1",
      type: "group",
      name: "Club",
      members: [PLAYER, "alice"],
    };
    renderWith(chatView(group));
    const text = await screen.findByRole("textbox", { name: "Message" });
    expect((text as HTMLTextAreaElement).placeholder).toBe("Message Club");
    fireEvent.change(text, { target: { value: "*waves*" } });
    await act(async () => fireEvent.keyDown(text, { key: "Enter" }));
    expect(vi.mocked(sendMessage).mock.calls[0]?.[0]).toMatchObject({
      text: "*waves*",
    });
    expect(vi.mocked(sendMessage).mock.calls[0]?.[0]).not.toHaveProperty(
      "type",
    );
  });

  it("keeps two earlier lines above the panel, oldest on top, each under its own name, and lets one go once faded", async () => {
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [
        message("alice", "First."),
        message(PLAYER, "Second."),
        message("bob", "waves.", "action"),
        message("alice", "Fourth."),
      ],
      hasMore: false,
    });
    renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await waitFor(() => expect(lines()).toEqual(["Alice: Fourth."]));
    // Oldest on top: drawn bottom up from the newest.
    const rows = [...document.querySelectorAll<HTMLElement>("[data-echo]")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "Bob waves.",
      "Player NameSecond.",
    ]);
    expect(rows[0]?.parentElement?.className).toContain("flex-col-reverse");
    // None between the plate and the line: outside the panel.
    expect(rows.every((row) => !row.closest("[data-panel]"))).toBe(true);
    expect(rows[1]?.className).toContain("opacity-75");
    const older = rows[1]?.firstElementChild as HTMLElement;
    expect(older.className).toContain("fade-out");
    endAnimation(older);
    expect(echoes()).toEqual(["Bob waves."]);
  });

  it("says why nobody answers in one slim row above the panel", async () => {
    renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    act(() =>
      stream().emit({
        type: "status",
        characterId: "alice",
        status: {
          brain: "idle",
          composingIn: [],
          queued: 0,
          onstage: true,
          failure: { error: "Quota exceeded.", at: 1 },
        },
      }),
    );
    const notice = await inScene().findByRole("status");
    expect(notice.textContent).toContain("Alice couldn't respond");
    expect(notice.closest("[data-panel]")).toBeNull();
    expect(notice.closest("[data-dock]")).not.toBeNull();
  });

  it("ends someone else's huddle's panel with the read-only note, without a reply box", async () => {
    const theirs: ChatInfo = { ...huddle(["alice", "carol"]), id: "theirs" };
    vi.mocked(fetchObservedChats).mockResolvedValue({ chats: [theirs] });
    renderWith(
      createElement(ObservedChatView, { chat: theirs, onBack: vi.fn() }),
      "?chats.id=theirs",
    );
    await waitFor(() => expect(scene()).not.toBeNull());
    const panel = document.querySelector("[data-panel]");
    expect(panel?.textContent).toContain(
      "Observing, read-only. Nobody here can tell.",
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("reading mode", () => {
  const SPEED = 5;
  /** Every speed the view asked the clock for, in order. */
  const speeds = () =>
    vi
      .mocked(executeClockAction)
      .mock.calls.map(([action]) =>
        action.action === "set_speed" ? action.speed : action.minutes,
      );
  const toggle = () =>
    fireEvent.click(screen.getByRole("button", { name: "Reading mode" }));
  const say = (id: string, text: string) =>
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message(id, text),
      }),
    );
  const corner = () =>
    document.querySelector<HTMLElement>("[data-reading]")?.dataset.reading;
  const words = () =>
    document.querySelector("[data-reading] [role=status]")?.textContent;

  function startAt(speed: number) {
    vi.mocked(fetchWorld).mockResolvedValue({
      ...world,
      clock: { ...world.clock, speed },
    });
  }
  beforeEach(() => {
    canManage = true;
    startAt(SPEED);
    vi.mocked(executeClockAction).mockImplementation(async (action) => ({
      clock: {
        ...world.clock,
        speed: action.action === "set_speed" ? action.speed : SPEED,
        updatedAt: Date.now(),
      },
    }));
  });

  async function reading() {
    const view = renderWith(chatView(huddle([PLAYER, "alice", "bob"])));
    await screen.findByText("Nobody has said anything yet.");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reading mode" }),
      ).toBeDefined(),
    );
    await waitFor(() => expect(view.container.textContent).toContain("Cafe"));
    await act(async () => {});
    toggle();
    expect(
      screen.getByRole("button", { name: "Reading mode", pressed: true }),
    ).toBeDefined();
    return view;
  }

  it("is an open book, off by default, offered only to a viewer who may control the clock, left of full screen", async () => {
    canManage = false;
    const first = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Reading mode" })).toBeNull();
    first.unmount();
    canManage = true;
    renderWith(chatView(huddle([PLAYER, "alice"])));
    const button = await screen.findByRole("button", { name: "Reading mode" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(
      button.compareDocumentPosition(
        screen.getByRole("button", { name: "Full screen" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector("[data-reading]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Auto" })).toBeNull();
  });

  it("holds each new line, the world paused while one waits; a click anywhere on the scene or a key shows it", async () => {
    const view = await reading();
    // Nothing waits: the world runs as it was.
    await act(async () => {});
    expect(speeds()).toEqual([]);
    expect(scene()?.className).toContain("cursor-pointer");
    say("alice", "One.");
    expect(screen.getByText("Nobody has said anything yet.")).toBeDefined();
    expect(corner()).toBe("ready");
    await waitFor(() => expect(speeds()).toEqual([0]));
    // A click on the backdrop, not only the panel.
    fireEvent.click(
      view.container.querySelector("[data-backdrop]") as HTMLElement,
    );
    expect(lines()).toEqual(["Alice: One."]);
    await waitFor(() => expect(speeds()).toEqual([0, SPEED]));
    // A burst: one pause, and the world runs again only after the last.
    say("bob", "Two.");
    say("alice", "Three.");
    await waitFor(() => expect(speeds()).toEqual([0, SPEED, 0]));
    fireEvent.keyDown(document.body, { key: " " });
    expect(lines()).toEqual(["Bob: Two."]);
    await act(async () => {});
    expect(speeds()).toEqual([0, SPEED, 0]);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(lines()).toEqual(["Alice: Three."]);
    await waitFor(() => expect(speeds()).toEqual([0, SPEED, 0, SPEED]));
    // Keys and clicks in the reply box are the reply box's.
    say("bob", "Four.");
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.keyDown(box, { key: " " });
    fireEvent.click(box);
    expect(lines()).toEqual(["Alice: Three."]);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(lines()).toEqual(["Bob: Four."]);
  });

  it("asked with nothing waiting, says who is thinking or speaking in words, and shows the line the moment it lands", async () => {
    await reading();
    expect(corner()).toBe("none");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(words()).toBe("Waiting for someone to speak");
    act(() =>
      stream().emit({
        type: "status",
        characterId: "bob",
        status: {
          brain: "thinking",
          composingIn: [],
          queued: 0,
          onstage: true,
        },
      }),
    );
    expect(words()).toBe("Bob is thinking");
    act(() =>
      stream().emit({
        type: "typing",
        chatId: "huddle",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "speaking",
      }),
    );
    expect(words()).toBe("Alice is speaking");
    expect(document.querySelector("[data-dots]")).toBeNull();
    say("alice", "Here.");
    expect(lines()).toEqual(["Alice: Here."]);
    await act(async () => {});
    expect(speeds()).toEqual([]);
  });

  it("does not call someone speaking whose line is already on screen", async () => {
    await reading();
    act(() =>
      stream().emit({
        type: "status",
        characterId: "bob",
        status: {
          brain: "thinking",
          composingIn: ["huddle"],
          queued: 0,
          onstage: true,
        },
      }),
    );
    // His line starts: ready at once, typed out when asked for, and whole on
    // a click meanwhile.
    const now = Date.now();
    act(() =>
      stream().emit({
        type: "typing",
        chatId: "huddle",
        senderId: "bob",
        senderName: "Bob",
        isTyping: true,
        mode: "speaking",
        speech: { text: "And here.", from: now, until: now + 60_000 },
      }),
    );
    expect(corner()).toBe("ready");
    const heard = () =>
      screen.getByRole("log").querySelector("[data-saying] [aria-hidden]")
        ?.textContent;
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(heard()).toBe("");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(heard()).toBe("And here.");
    // Asked for the next while its saying runs on: he is not "speaking" a
    // line the reader has; what is true is that he is thinking.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(words()).toBe("Bob is thinking");
  });

  it("types out each bubble of one send and changes the face only when its line is reached", async () => {
    const { container } = await reading();
    await waitFor(() => expect(figureIds(container)).toContain("alice"));
    await screen.findByRole("img", { name: "Alice" });
    const picture = () =>
      figure(container, "alice")?.querySelector("img")?.getAttribute("src");
    const heard = () =>
      screen.getByRole("log").querySelector("[data-saying] [aria-hidden]")
        ?.textContent;
    const now = DAY + 12 * HOUR;
    const bubble = (text: string, face: string) =>
      act(() =>
        stream().emit({
          type: "typing",
          chatId: "huddle",
          senderId: "alice",
          senderName: "Alice",
          isTyping: true,
          mode: "speaking",
          speech: { text, face: { name: face }, from: now, until: now + HOUR },
        }),
      );
    const lands = (text: string, face: string) =>
      act(() =>
        stream().emit({
          type: "message",
          chatId: "huddle",
          message: { ...message("alice", text), face: { name: face } },
        }),
      );
    // The first bubble, asked for before it came.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    bubble("Finally!", "happy");
    expect(picture()).toBe("/p/alice-happy");
    lands("Finally!", "happy");
    // The second starts while the first is still being read: it waits, and so
    // does its face.
    bubble("Wait, no.", "neutral");
    expect(corner()).toBe("ready");
    expect(picture()).toBe("/p/alice-happy");
    lands("Wait, no.", "neutral");
    expect(picture()).toBe("/p/alice-happy");
    expect(lines()).toEqual(["Alice: Finally!"]);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(picture()).toBe("/p/alice-neutral");
    // A third, reached while it is being said: typed out, not shown whole.
    bubble("Never mind.", "happy");
    expect(picture()).toBe("/p/alice-neutral");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(picture()).toBe("/p/alice-happy");
    expect(heard()).not.toBe("Never mind.");
  });

  it("starts a paused world at 1x, and pauses it again when turned off", async () => {
    startAt(0);
    await reading();
    await waitFor(() => expect(speeds()).toEqual([1]));
    toggle();
    await waitFor(() => expect(speeds()).toEqual([1, 0]));
  });

  it("shows what waited before a reply is sent, and lets the world run once it is", async () => {
    let delivered: () => void = () => {};
    vi.mocked(sendMessage).mockImplementation(
      (payload) =>
        new Promise((resolve) => {
          delivered = () =>
            resolve({
              chatId: "huddle",
              sessionKey: "chat:huddle:1",
              status: "delivered",
              message: {
                ...message(PLAYER, payload.text),
                requestId: payload.requestId,
              },
            });
        }),
    );
    await reading();
    say("alice", "Unread one.");
    say("bob", "Unread two.");
    await waitFor(() => expect(speeds()).toEqual([0]));
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "My answer." } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(lines()).toEqual(["Bob: Unread two."]);
    expect(echoes()).toContain("AliceUnread one.");
    expect(speeds()).toEqual([0]);
    await act(async () => delivered());
    await waitFor(() => expect(speeds()).toEqual([0, SPEED]));
    // Nobody clicks through their own line: the answer shows as it comes.
    await waitFor(() => expect(lines()).toEqual(["Player Name: My answer."]));
    say("alice", "An answer.");
    expect(lines()).toEqual(["Alice: An answer."]);
    // What follows that waits for the reader again.
    say("bob", "And more.");
    expect(lines()).toEqual(["Alice: An answer."]);
    expect(corner()).toBe("ready");
  });

  it.each<[string, () => void]>([
    ["it is turned off", () => toggle()],
    [
      "the transcript is shown",
      () => fireEvent.click(screen.getByRole("button", { name: "Transcript" })),
    ],
  ])(
    "ends when %s, showing what waited and putting back the speed found",
    async (_, end) => {
      await reading();
      say("alice", "Waiting.");
      await waitFor(() => expect(speeds()).toEqual([0]));
      act(() => end());
      await waitFor(() => expect(speeds()).toEqual([0, SPEED]));
      fireEvent.click(screen.getByRole("button", { name: "Scene" }));
      await waitFor(() => expect(scene()).not.toBeNull());
      await waitFor(() => expect(lines()).toEqual(["Alice: Waiting."]));
      expect(
        screen.getByRole("button", { name: "Reading mode", pressed: false }),
      ).toBeDefined();
    },
  );

  it("ends when the chat closes, putting back the speed", async () => {
    const view = await reading();
    say("alice", "Waiting.");
    await waitFor(() => expect(speeds()).toEqual([0]));
    view.unmount();
    expect(speeds()).toEqual([0, SPEED]);
  });

  it("lets go, without a fight, when the speed is changed elsewhere", async () => {
    await reading();
    say("alice", "Waiting.");
    await waitFor(() => expect(speeds()).toEqual([0]));
    act(() =>
      stream().emit({
        type: "clock",
        clock: { ...world.clock, speed: 60, updatedAt: Date.now() },
      }),
    );
    expect(
      screen.getByRole("button", { name: "Reading mode", pressed: false }),
    ).toBeDefined();
    expect(lines()).toEqual(["Alice: Waiting."]);
    await act(async () => {});
    expect(speeds()).toEqual([0]);
  });
});

describe("the backlog", () => {
  const backlog = () => screen.queryByRole("dialog", { name: "Backlog" });

  it("opens from an echo over the scene, at the transcript, and closes by its button, the shade or Escape", async () => {
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [message("alice", "Earlier."), message("alice", "Latest.")],
      hasMore: false,
    });
    const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(lines()).toEqual(["Alice: Latest."]));
    const echo = screen.getByRole("button", { name: /Earlier\./ });
    // As a click does in a browser: focus on the echo, then the click.
    echo.focus();
    fireEvent.click(echo);
    const dialog = backlog();
    expect(dialog).not.toBeNull();
    // Inside the stage, beside the scene: the same transcript.
    expect(container.querySelector("[data-fullscreen]")?.contains(dialog)).toBe(
      true,
    );
    expect(scene()?.contains(dialog)).toBe(false);
    expect(within(dialog as HTMLElement).getByText("Latest.")).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close backlog" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close backlog" }));
    expect(backlog()).toBeNull();
    expect(document.activeElement).toBe(echo);

    fireEvent.click(echo);
    fireEvent.click(
      container.querySelector("[data-backlog] > [aria-hidden]") as HTMLElement,
    );
    expect(backlog()).toBeNull();
    fireEvent.click(echo);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(backlog()).toBeNull();
  });

  it("opens from full screen's cluster, and Escape then closes only it", async () => {
    const { container } = renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(scene()).not.toBeNull());
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Full screen" })),
    );
    const stage = container.querySelector<HTMLElement>("[data-fullscreen]");
    expect(stage?.dataset.fullscreen).toBe("window");
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Scene" })).getByRole(
        "button",
        { name: "Backlog" },
      ),
    );
    expect(backlog()).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    expect(backlog()).toBeNull();
    expect(stage?.dataset.fullscreen).toBe("window");
    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(stage?.dataset.fullscreen).toBe("off");
  });

  it("advances nothing in reading mode while it is open", async () => {
    canManage = true;
    vi.mocked(executeClockAction).mockImplementation(async (action) => ({
      clock: {
        ...world.clock,
        speed: action.action === "set_speed" ? action.speed : 1,
      },
    }));
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [message("alice", "Earlier."), message("alice", "Latest.")],
      hasMore: false,
    });
    renderWith(chatView(huddle([PLAYER, "alice"])));
    await waitFor(() => expect(lines()).toEqual(["Alice: Latest."]));
    fireEvent.click(
      await screen.findByRole("button", { name: "Reading mode" }),
    );
    act(() =>
      stream().emit({
        type: "message",
        chatId: "huddle",
        message: message("alice", "Waiting."),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Earlier\./ }));
    const dialog = backlog() as HTMLElement;
    fireEvent.click(within(dialog).getByText("Latest."));
    fireEvent.keyDown(within(dialog).getByText("Latest."), { key: " " });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Close backlog" }));
    expect(lines()).toEqual(["Alice: Latest."]);
    fireEvent.click(screen.getByRole("log"));
    expect(lines()).toEqual(["Alice: Waiting."]);
  });
});
