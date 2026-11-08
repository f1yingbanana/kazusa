// @vitest-environment jsdom
import { createElement, StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CharacterStatus,
  CharacterSummary,
  JournalEvent,
  LocationsResponse,
  StreamEvent,
} from "@kazusa/client";
import { SourcesProvider } from "../source/provider";
import { RealtimeProvider } from "./realtime-provider";
import { useLiveStore } from "./state";
import { useClockStore } from "./clock-state";
import { useRealtimeStore, useTyping } from "./realtime-state";
import { fetchChats, fetchMessages } from "../source/chats/http";
import { fetchWorld } from "../source/clock/http";
import { fetchCharacters } from "../source/characters/http";
import { fetchDesires } from "../source/desires/http";
import { fetchLocations, fetchPlaces } from "../source/location/http";
import { fetchTimeline } from "../source/timeline/http";
import { useCharacterStatus, useCharacters } from "../../hooks/use-characters";
import { useDesireConfig } from "../../hooks/use-desires";
import { usePlaces } from "../../hooks/use-location";
import { useMessages } from "../../hooks/use-chats";
import { useTimeline, useRecentEvents } from "../../hooks/use-timeline";

vi.mock("../source/chats/http", async (original) => ({
  ...(await original<typeof import("../source/chats/http")>()),
  fetchChats: vi.fn(),
  fetchMessages: vi.fn(),
}));
vi.mock("../source/clock/http", () => ({ fetchWorld: vi.fn() }));
vi.mock("../source/characters/http", () => ({ fetchCharacters: vi.fn() }));
vi.mock("../source/desires/http", async (original) => ({
  ...(await original<typeof import("../source/desires/http")>()),
  fetchDesires: vi.fn(),
}));
vi.mock("../source/location/http", async (original) => ({
  ...(await original<typeof import("../source/location/http")>()),
  fetchLocations: vi.fn(),
  fetchPlaces: vi.fn(),
}));
vi.mock("../source/timeline/http", () => ({ fetchTimeline: vi.fn() }));

const idle: CharacterStatus = {
  brain: "idle",
  composingIn: [],
  queued: 0,
  onstage: true,
};

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

function wrapper({ children }: { children: ReactNode }) {
  // A cache is created once per wrapper instance by SWRConfig.
  return createElement(
    StrictMode,
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
        children: createElement(RealtimeProvider, { children }),
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource);
  useLiveStore.setState(useLiveStore.getInitialState(), true);
  useClockStore.setState(useClockStore.getInitialState(), true);
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  vi.mocked(fetchChats).mockResolvedValue({
    user: { id: "user:you", name: "You" },
    chats: [],
  });
  vi.mocked(fetchMessages).mockResolvedValue({ messages: [], hasMore: false });
  vi.mocked(fetchWorld).mockResolvedValue({
    user: { id: "user:you", name: "You" },
    serverNow: Date.now(),
    clock: { simTime: 60_000, speed: 0, updatedAt: Date.now() },
    world: { title: "Test world" },
    capabilities: {
      characters: "live",
      status: "live",
      desires: "live",
      places: "live",
      location: "live",
      clock: "live",
      timeline: "live",
    },
  });
  vi.mocked(fetchCharacters).mockResolvedValue([
    { id: "alice", name: "Alice", kind: "agent", aliases: [], status: idle },
  ]);
  vi.mocked(fetchDesires).mockResolvedValue({
    config: {
      initial: "ok",
      states: [{ name: "ok", min: 0, level: 50 }],
      catalog: [],
    },
    records: { alice: { anchorAt: 1, levels: {}, drain: {} } },
  });
  vi.mocked(fetchPlaces).mockResolvedValue({ places: [] });
  vi.mocked(fetchLocations).mockResolvedValue({
    records: { alice: { placeId: "home", since: 0 } },
  });
  vi.mocked(fetchTimeline).mockResolvedValue({ events: [], hasMore: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SWR snapshots and SSE lifecycle", () => {
  it("follows browser connectivity even when an idle stream emits no transport error", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result, unmount } = renderHook(
      () => useRealtimeStore((state) => state.status),
      { wrapper },
    );
    await waitFor(() => expect(result.current).toBe("error"));
    expect(TestEventSource.instances).toHaveLength(0);
    act(() => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    expect(TestEventSource.instances).toHaveLength(1);
    const source = TestEventSource.instances[0];
    act(() => {
      source.onopen?.();
      source.emit({
        type: "typing",
        chatId: "chat",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "typing",
      });
    });
    expect(result.current).toBe("open");
    act(() => {
      online.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe("error");
    expect(source.close).toHaveBeenCalledOnce();
    expect(useRealtimeStore.getState().typingByChat).toEqual({});
    act(() => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe("connecting");
    expect(TestEventSource.instances).toHaveLength(2);
    expect(
      TestEventSource.instances.filter((s) => s.readyState === 1),
    ).toHaveLength(1);
    unmount();
    act(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    expect(TestEventSource.instances).toHaveLength(2);
    expect(TestEventSource.instances.every((s) => s.readyState === 2)).toBe(
      true,
    );
  });

  it("keeps status and location stream updates that arrive before their HTTP snapshots", async () => {
    const characters = Promise.withResolvers<CharacterSummary[]>();
    const locations = Promise.withResolvers<LocationsResponse>();
    vi.mocked(fetchCharacters).mockReturnValue(characters.promise);
    vi.mocked(fetchLocations).mockReturnValue(locations.promise);
    renderHook(() => useCharacterStatus("alice"), { wrapper });
    await waitFor(() => expect(fetchLocations).toHaveBeenCalledOnce());
    const source = TestEventSource.instances.findLast(
      (s) => s.readyState === 1,
    );
    expect(source).toBeDefined();
    act(() => {
      source?.emit({
        type: "status",
        characterId: "alice",
        status: { ...idle, brain: "thinking" },
      });
      source?.emit({
        type: "location",
        characterId: "alice",
        record: { placeId: "road", since: 10 },
      });
    });
    await act(async () => {
      characters.resolve([
        {
          id: "alice",
          name: "Alice",
          kind: "agent",
          aliases: [],
          status: idle,
        },
      ]);
      locations.resolve({ records: { alice: { placeId: "home", since: 0 } } });
      await Promise.all([characters.promise, locations.promise]);
    });
    expect(useLiveStore.getState().statuses.get("alice")?.brain).toBe(
      "thinking",
    );
    expect(useLiveStore.getState().locations.get("alice")?.placeId).toBe(
      "road",
    );
  });

  it("does not refetch on sparse journal sequences and refreshes mounted history after reconnect", async () => {
    const journal = (seq: number): JournalEvent => ({
      seq,
      simTime: seq,
      kind: "clock.changed",
      actors: ["alice"],
      payload: { speed: 1 },
    });
    let history = [journal(1)];
    vi.mocked(fetchTimeline).mockImplementation(async (query) => ({
      // The recent unfiltered window need not contain the actor's older events.
      events: query.limit === 200 ? [] : history,
      hasMore: false,
    }));
    const { result } = renderHook(
      () => ({
        timeline: useTimeline({ actors: ["alice"] }),
        recent: useRecentEvents("alice", 5, ["clock.changed"]),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.timeline.events.map((e) => e.seq)).toEqual([1]),
    );
    await waitFor(() =>
      expect(result.current.recent.events.map((e) => e.seq)).toEqual([1]),
    );
    const calls = vi.mocked(fetchTimeline).mock.calls.length;
    const source = TestEventSource.instances.findLast(
      (s) => s.readyState === 1,
    );
    act(() => {
      source?.emit({ type: "journal", event: journal(1000) });
      source?.emit({ type: "journal", event: journal(3000) });
    });
    expect(result.current.timeline.events.map((e) => e.seq)).toEqual([
      3000, 1000, 1,
    ]);
    expect(fetchTimeline).toHaveBeenCalledTimes(calls);
    history = [journal(3000), journal(2000), journal(1000), journal(1)];
    await act(async () => source?.emit({ type: "connected", typing: [] }));
    await waitFor(() =>
      expect(result.current.timeline.events.map((e) => e.seq)).toEqual([
        3000, 2000, 1000, 1,
      ]),
    );
    expect(result.current.recent.events.map((e) => e.seq)).toEqual([
      3000, 2000, 1000, 1,
    ]);
  });

  it("shares SWR resources, seeds live projections, and keeps one stream in StrictMode", async () => {
    const { result, unmount } = renderHook(
      () => ({
        alice: useCharacterStatus("alice"),
        characters: useCharacters(),
        desires: useDesireConfig(),
        places: usePlaces(),
        typing: useTyping("chat"),
        status: useRealtimeStore((state) => state.status),
        messages: useMessages("chat"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current?.alice?.brain).toBe("idle"));
    await waitFor(() => expect(result.current.places?.places).toEqual([]));
    expect(result.current.desires?.initial).toBe("ok");
    expect(useLiveStore.getState().locations.get("alice")?.placeId).toBe(
      "home",
    );
    expect(fetchCharacters).toHaveBeenCalledOnce();
    const sources = TestEventSource.instances.filter(
      (source) => source.readyState !== TestEventSource.CLOSED,
    );
    expect(sources).toHaveLength(1);
    const source = sources[0];
    act(() => source.onopen?.());
    expect(result.current.status).toBe("open");
    act(() =>
      source.emit({
        type: "status",
        characterId: "alice",
        status: { ...idle, brain: "thinking" },
      }),
    );
    expect(result.current.alice?.brain).toBe("thinking");
    act(() =>
      source.emit({
        type: "typing",
        chatId: "chat",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "typing",
      }),
    );
    expect(result.current.typing).toHaveLength(1);
    await act(async () =>
      source.emit({
        type: "message",
        chatId: "chat",
        message: {
          id: "message-one",
          requestId: "request-one",
          sequence: 1,
          senderId: "alice",
          senderName: "Alice",
          text: "Hello",
          timestamp: 60_000,
        },
      }),
    );
    await waitFor(() =>
      expect(result.current.messages.messages.map((m) => m.text)).toEqual([
        "Hello",
      ]),
    );
    expect(result.current.typing).toHaveLength(0);
    expect(useRealtimeStore.getState().unreadByChat.chat).toBe(1);
    await act(async () =>
      source.emit({ type: "connected", typing: [], statuses: { bob: idle } }),
    );
    expect(result.current.alice).toBeUndefined();
    expect(useLiveStore.getState().statuses.has("bob")).toBe(true);
    await waitFor(() => expect(fetchLocations).toHaveBeenCalledTimes(2));
    expect(
      TestEventSource.instances.filter((s) => s.readyState !== 2),
    ).toHaveLength(1);
    unmount();
    expect(source.close).toHaveBeenCalledOnce();
    expect(useRealtimeStore.getState().typingByChat).toEqual({});
  });

  it("clears stale typing and reconnects after a closed transport", async () => {
    const { result, unmount } = renderHook(
      () => useRealtimeStore((state) => state.status),
      { wrapper },
    );
    await waitFor(() =>
      expect(TestEventSource.instances.some((s) => s.readyState === 1)).toBe(
        true,
      ),
    );
    const source = TestEventSource.instances.findLast(
      (s) => s.readyState === 1,
    );
    expect(source).toBeDefined();
    act(() => {
      source?.emit({
        type: "typing",
        chatId: "chat",
        senderId: "alice",
        senderName: "Alice",
        isTyping: true,
        mode: "typing",
      });
      if (source) source.readyState = TestEventSource.CLOSED;
      source?.onerror?.();
    });
    expect(result.current).toBe("error");
    expect(useRealtimeStore.getState().typingByChat).toEqual({});
    await waitFor(
      () =>
        expect(
          TestEventSource.instances.filter((s) => s.readyState === 1),
        ).toHaveLength(1),
      { timeout: 2_000 },
    );
    unmount();
    expect(TestEventSource.instances.every((s) => s.readyState === 2)).toBe(
      true,
    );
  });
});
