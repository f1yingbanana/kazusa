// @vitest-environment jsdom
import { createElement, StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Chat,
  ChatMessage,
  PlacesResponse,
  StreamEvent,
  WorldResponse,
} from "@kazusa/client";
import { SourcesProvider } from "../lib/source/provider";
import { RealtimeProvider } from "../lib/live/realtime-provider";
import { useLiveStore } from "../lib/live/state";
import { setClock, useClockStore } from "../lib/live/clock-state";
import { useRealtimeStore } from "../lib/live/realtime-state";
import {
  useSceneFigures,
  useSceneEchoes,
  useSceneLine,
  useSceneStore,
} from "../lib/live/scene-state";
import { fetchChats, fetchMessages } from "../lib/source/chats/http";
import { fetchWorld } from "../lib/source/clock/http";
import { fetchCharacters } from "../lib/source/characters/http";
import { fetchLocations, fetchPlaces } from "../lib/source/location/http";
import {
  fetchObservedChats,
  fetchObservedMessages,
} from "../lib/source/observe/http";
import { fetchPortraits } from "../lib/source/scene/http";
import { useChatActions, useChatsResource, useMessages } from "./use-chats";
import { useObservedChats, useObservedMessages } from "./use-observed-chats";
import { useBackdrop, usePortraits, useSceneSession } from "./use-scene";

vi.mock("../lib/source/chats/http", async (original) => ({
  ...(await original<typeof import("../lib/source/chats/http")>()),
  fetchChats: vi.fn(),
  fetchMessages: vi.fn(),
}));
vi.mock("../lib/source/clock/http", () => ({ fetchWorld: vi.fn() }));
vi.mock("../lib/source/characters/http", () => ({ fetchCharacters: vi.fn() }));
vi.mock("../lib/source/location/http", async (original) => ({
  ...(await original<typeof import("../lib/source/location/http")>()),
  fetchLocations: vi.fn(),
  fetchPlaces: vi.fn(),
}));
vi.mock("../lib/source/observe/http", async (original) => ({
  ...(await original<typeof import("../lib/source/observe/http")>()),
  fetchObservedChats: vi.fn(),
  fetchObservedMessages: vi.fn(),
}));
vi.mock("../lib/source/scene/http", async (original) => ({
  ...(await original<typeof import("../lib/source/scene/http")>()),
  fetchPortraits: vi.fn(),
}));

const PLAYER = "user:you";
/** What a scene shows: its echoes, oldest first, then the panel's line. */
function useShown(chatId: string) {
  const echoes = useSceneEchoes(chatId);
  const line = useSceneLine(chatId);
  return line ? [...echoes, line] : echoes;
}
const DAY = Date.UTC(2026, 10, 11);
const HOUR = 3_600_000;

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
const stream = () =>
  TestEventSource.instances.findLast((source) => source.readyState === 1);

/** A new cache per mount, or `cache` for mounts that should share one. */
const wrapperOn = (cache?: Map<string, unknown>) =>
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(
      StrictMode,
      null,
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => cache ?? new Map(),
            dedupingInterval: 0,
            errorRetryCount: 0,
          },
        },
        createElement(SourcesProvider, {
          fallback: null,
          children: createElement(RealtimeProvider, { children }),
        }),
      ),
    );
  };
const wrapper = wrapperOn();

let seq = 0;
const message = (senderId: string, text: string): ChatMessage => {
  seq += 1;
  return {
    id: `m${seq}`,
    requestId: `r${seq}`,
    sequence: seq,
    senderId,
    senderName: senderId,
    text,
    timestamp: seq,
  };
};
const huddle = (members: string[]): Chat => ({
  id: "huddle",
  sessionKey: "chat:huddle:1",
  type: "huddle",
  name: "",
  members,
  placeId: "cafe",
});
const world = (scene: "live" | "unavailable"): WorldResponse => ({
  user: { id: PLAYER, name: "Player Name" },
  serverNow: Date.now(),
  clock: { simTime: DAY + 12 * HOUR, speed: 0, updatedAt: Date.now() },
  world: { title: "Test world" },
  capabilities: {
    characters: "live",
    status: "live",
    places: "live",
    location: "live",
    clock: "live",
    observe: "live",
    scene,
  },
});
const PLACES: PlacesResponse = {
  places: [
    {
      id: "cafe",
      name: "Cafe",
      aliases: [],
      summary: "",
      entryMinutes: 0,
      connections: [],
      bodyMarkdown: "",
      backdrop: "cafe",
    },
    {
      id: "street",
      name: "Street",
      aliases: [],
      summary: "",
      entryMinutes: 0,
      connections: [],
      bodyMarkdown: "",
    },
  ],
  backdrops: {
    cafe: {
      files: [
        { name: "day", url: "/b/day", time: "day" },
        { name: "night", url: "/b/night", time: "night" },
      ],
    },
  },
  times: [
    { name: "day", from: "06:00" },
    { name: "night", from: "19:00" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource);
  useLiveStore.setState(useLiveStore.getInitialState(), true);
  useClockStore.setState(useClockStore.getInitialState(), true);
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSceneStore.setState(useSceneStore.getInitialState(), true);
  vi.mocked(fetchWorld).mockResolvedValue(world("live"));
  vi.mocked(fetchCharacters).mockResolvedValue([
    {
      id: "alice",
      name: "Alice",
      kind: "agent",
      aliases: [],
      portraitUrl: "/kazusa/portrait?id=alice&name=neutral&v=1",
    },
    { id: "bob", name: "Bob", kind: "agent", aliases: [] },
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
    portraits: [{ name: "neutral", url: "/p/neutral", mood: "neutral" }],
    default: "neutral",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scene wiring", () => {
  it("feeds the player's huddle from list reads, history, typing and messages", async () => {
    const said = message("alice", "Before you came.");
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [said],
      hasMore: false,
    });
    const { result, unmount } = renderHook(
      () => {
        useChatsResource();
        useMessages("huddle");
        useSceneSession("huddle", 5);
        return {
          figures: useSceneFigures("huddle"),
          lines: useShown("huddle"),
          actions: useChatActions(),
        };
      },
      { wrapper },
    );
    // Members from the list read, the last line from the history read; Bob
    // has no portraits, so only Alice is drawn.
    await waitFor(() =>
      expect(result.current.figures.map((f) => f.id)).toEqual(["alice"]),
    );
    await waitFor(() =>
      expect(result.current.lines.map((l) => l.text)).toEqual([
        "Before you came.",
      ]),
    );
    const source = stream();
    act(() =>
      source?.emit({
        type: "typing",
        chatId: "huddle",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "speaking",
      }),
    );
    expect(useSceneStore.getState().scenes.huddle?.speakers).toEqual(["alice"]);
    // The line commits; the stream's own repeat is ignored.
    const line = message("alice", "Hi.");
    act(() => {
      source?.emit({ type: "message", chatId: "huddle", message: line });
      source?.emit({ type: "message", chatId: "huddle", message: line });
    });
    expect(useSceneStore.getState().scenes.huddle?.speakers).toEqual([]);
    // Her line being said is filled in, the earlier one above it.
    expect(result.current.lines.map((l) => l.text)).toEqual([
      "Before you came.",
      "Hi.",
    ]);
    // The player's send shows at once, under their name, and once.
    const mine = message(PLAYER, "Hello.");
    mine.senderName = "Player Name";
    act(() => result.current.actions.commitSentMessage("huddle", mine));
    act(() =>
      source?.emit({ type: "message", chatId: "huddle", message: mine }),
    );
    expect(
      result.current.lines.map((l) => `${l.speakerName}: ${l.text}`),
    ).toEqual(["alice: Before you came.", "alice: Hi.", "Player Name: Hello."]);
    // Reconnecting: speakers start over from the replayed typists.
    act(() =>
      source?.emit({
        type: "typing",
        chatId: "huddle",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "speaking",
      }),
    );
    await act(async () =>
      source?.emit({
        type: "connected",
        typing: [
          {
            type: "typing",
            chatId: "huddle",
            senderId: "bob",
            senderName: "Bob",
            isTyping: true,
            mode: "speaking",
          },
        ],
      }),
    );
    expect(useSceneStore.getState().scenes.huddle?.speakers).toEqual(["bob"]);
    // Alice walks off: the chat list changes, its refetch carries it.
    vi.mocked(fetchChats).mockResolvedValue({
      user: { id: PLAYER, name: "Player Name" },
      chats: [huddle([PLAYER, "bob"])],
    });
    await act(async () => source?.emit({ type: "chats" }));
    await waitFor(() =>
      expect(
        result.current.figures.find((f) => f.id === "alice")?.presence,
      ).toBe("leaving"),
    );
    unmount();
    expect(useSceneStore.getState().scenes).toEqual({});
  });

  it("opens from what is cached and follows someone else's huddle through observed events", async () => {
    vi.mocked(fetchObservedChats).mockResolvedValue({
      chats: [{ ...huddle(["alice", "bob"]), id: "theirs", placeId: "street" }],
    });
    vi.mocked(fetchObservedMessages).mockResolvedValue({
      messages: [message("bob", "Earlier.")],
      hasMore: false,
    });
    const cache = new Map<string, unknown>();
    const reader = renderHook(
      () => ({
        chats: useObservedChats().chats,
        messages: useObservedMessages("theirs").messages,
      }),
      { wrapper: wrapperOn(cache) },
    );
    await waitFor(() => expect(reader.result.current.messages).toHaveLength(1));
    reader.unmount();

    // A second view on the same cache would be the norm; here the session
    // mounts after the reads land, so it seeds from the cache alone: its own
    // reads never land.
    vi.mocked(fetchObservedChats).mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchObservedMessages).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => {
        const observed = useObservedChats();
        const messages = useObservedMessages(
          observed.chats.length ? "theirs" : null,
        );
        useSceneSession(messages.messages.length ? "theirs" : null, 5);
        return {
          figures: useSceneFigures("theirs"),
          lines: useShown("theirs"),
        };
      },
      { wrapper: wrapperOn(cache) },
    );
    expect(result.current.lines.map((l) => l.text)).toEqual(["Earlier."]);
    // Seeded with the roster already read: Alice stands there, nobody walks
    // in; Bob, without portraits, is not drawn.
    expect(result.current.figures.map((f) => [f.id, f.presence])).toEqual([
      ["alice", "here"],
    ]);
    const source = stream();
    act(() => {
      source?.emit({
        type: "observed",
        event: {
          type: "typing",
          chatId: "theirs",
          senderId: "alice",
          senderName: "Alice",
          isTyping: true,
          mode: "speaking",
        },
      });
    });
    expect(useSceneStore.getState().scenes.theirs?.speakers).toEqual(["alice"]);
    act(() =>
      source?.emit({
        type: "observed",
        event: {
          type: "message",
          chatId: "theirs",
          message: message("alice", "Later."),
        },
      }),
    );
    expect(result.current.lines.map((l) => l.text)).toEqual([
      "Earlier.",
      "Later.",
    ]);
    // An ended huddle: everyone walks off.
    vi.mocked(fetchObservedChats).mockResolvedValue({
      chats: [
        {
          ...huddle(["alice", "bob"]),
          id: "theirs",
          placeId: "street",
          ended: true,
        },
      ],
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => source?.emit({ type: "observed", event: { type: "chats" } }));
    await act(async () => vi.advanceTimersByTimeAsync(2_500));
    vi.useRealTimers();
    await waitFor(() =>
      expect(
        result.current.figures.every((f) => f.presence === "leaving"),
      ).toBe(true),
    );
  });
});

describe("art hooks", () => {
  it("fetches portraits only for characters who have them, and picks the backdrop by sim time", async () => {
    const renders = vi.fn();
    const { result } = renderHook(
      () => {
        renders();
        return {
          // SWR re-renders only for fields read while rendering.
          alice: usePortraits("alice").data,
          bob: usePortraits("bob").data,
          backdrop: useBackdrop("cafe"),
          street: useBackdrop("street"),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.alice?.default).toBe("neutral"));
    expect(result.current.bob).toBeUndefined();
    expect(fetchPortraits).toHaveBeenCalledWith("alice");
    expect(fetchPortraits).not.toHaveBeenCalledWith("bob");
    await waitFor(() => expect(result.current.backdrop?.name).toBe("day"));
    expect(result.current.street).toBeUndefined();
    // Each minute of clock samples re-renders nothing until the picture changes.
    const count = renders.mock.calls.length;
    act(() => {
      for (let minute = 1; minute <= 30; minute++)
        useClockStore.setState({ simNow: DAY + 12 * HOUR + minute * 60_000 });
    });
    expect(renders).toHaveBeenCalledTimes(count);
    act(() => {
      const clock = useClockStore.getState().clock;
      if (clock)
        setClock({
          ...clock,
          clock: { ...clock.clock, simTime: DAY + 20 * HOUR },
        });
    });
    expect(result.current.backdrop?.name).toBe("night");
  });

  it("draws nobody until the roster says who has portraits, then walks them in", async () => {
    const roster = await fetchCharacters();
    let rosterArrives: (value: typeof roster) => void = () => {};
    vi.mocked(fetchCharacters).mockImplementation(
      () => new Promise((resolve) => (rosterArrives = resolve)),
    );
    const { result } = renderHook(
      () => {
        const chats = useChatsResource().data;
        useSceneSession(chats ? "huddle" : null, 5);
        return {
          open: useSceneStore((state) => "huddle" in state.scenes),
          figures: useSceneFigures("huddle"),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.open).toBe(true));
    // Members known, the roster not: nothing drawn, no place kept.
    expect(result.current.figures).toEqual([]);
    await act(async () => rosterArrives(roster));
    await waitFor(() =>
      expect(result.current.figures.map((f) => [f.id, f.presence])).toEqual([
        ["alice", "entering"],
      ]),
    );
  });

  it("draws nothing without the scene capability", async () => {
    vi.mocked(fetchWorld).mockResolvedValue(world("unavailable"));
    const { result } = renderHook(
      () => {
        const chats = useChatsResource().data;
        useSceneSession(chats ? "huddle" : null, 5);
        return {
          portraits: usePortraits("alice").data,
          backdrop: useBackdrop("cafe"),
          open: useSceneStore((state) => "huddle" in state.scenes),
          figures: useSceneFigures("huddle"),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(fetchPlaces).toHaveBeenCalled());
    await waitFor(() => expect(fetchCharacters).toHaveBeenCalled());
    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.backdrop).toBeUndefined();
    expect(result.current.figures).toEqual([]);
    expect(useSceneStore.getState().scenes.huddle?.drawable).toEqual(new Set());
    expect(fetchPortraits).not.toHaveBeenCalled();
  });
});
