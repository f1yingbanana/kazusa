// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CharacterStatus,
  DesireRecord,
  JournalEvent,
} from "@kazusa/client";
import {
  setDesires,
  setLocations,
  setStatuses,
  updateDesire,
  updateLocation,
  useLiveStore,
} from "./state";
import { dispatchLive } from "../registry/live";
import { useCharacterStatus } from "../../hooks/use-characters";
import { useLocationRecord } from "../../hooks/use-location";
import { useDesireRecord } from "../../hooks/use-desires";
import { useOffstage } from "../../hooks/use-stage";

const idle: CharacterStatus = {
  brain: "idle",
  composingIn: [],
  queued: 0,
  onstage: true,
};
const desire = (anchorAt: number): DesireRecord => ({
  anchorAt,
  levels: { hunger: 50 },
  drain: {},
});
const event = (seq: number): JournalEvent => ({
  seq,
  simTime: seq * 1000,
  kind: "clock.changed",
  actors: [],
  payload: { speed: 1 },
});

beforeEach(() => useLiveStore.setState(useLiveStore.getInitialState(), true));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Zustand live selectors", () => {
  it("renders only the affected character and removes missing snapshot entries", () => {
    setStatuses([
      ["alice", idle],
      ["bob", idle],
    ]);
    const aliceRender = vi.fn();
    const bobRender = vi.fn();
    const alice = renderHook(() => {
      aliceRender();
      return useCharacterStatus("alice");
    });
    const bob = renderHook(() => {
      bobRender();
      return useCharacterStatus("bob");
    });
    const oldSnapshot = useLiveStore.getState().statuses;
    act(() =>
      dispatchLive({
        type: "status",
        characterId: "alice",
        status: { ...idle, brain: "thinking" },
      }),
    );
    expect(alice.result.current?.brain).toBe("thinking");
    expect(aliceRender).toHaveBeenCalledTimes(2);
    expect(bobRender).toHaveBeenCalledOnce();
    expect(oldSnapshot.get("alice")).toBe(idle);
    act(() => setStatuses([["alice", idle]]));
    expect(bob.result.current).toBeUndefined();
  });

  it("keeps offstage selectors stable across brain changes", () => {
    setStatuses([
      ["alice", { ...idle, onstage: false }],
      ["bob", idle],
    ]);
    const render = vi.fn();
    const { result } = renderHook(() => {
      render();
      return useOffstage();
    });
    const offstage = result.current;
    act(() =>
      dispatchLive({
        type: "status",
        characterId: "bob",
        status: { ...idle, brain: "thinking" },
      }),
    );
    expect(result.current).toBe(offstage);
    expect(render).toHaveBeenCalledOnce();
    act(() =>
      dispatchLive({ type: "status", characterId: "alice", status: idle }),
    );
    expect(result.current.size).toBe(0);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("isolates locations and desires and rejects older desire snapshots and events", () => {
    const home = { placeId: "home", since: 0 };
    setLocations([["alice", home]]);
    setDesires([["alice", desire(10)]]);
    const render = vi.fn();
    const { result } = renderHook(() => {
      render();
      return {
        location: useLocationRecord("alice"),
        desire: useDesireRecord("alice"),
      };
    });
    act(() => {
      dispatchLive({ type: "location", characterId: "bob", record: home });
      dispatchLive({ type: "desires", characterId: "bob", record: desire(20) });
    });
    expect(render).toHaveBeenCalledOnce();
    act(() =>
      dispatchLive({
        type: "desires",
        characterId: "alice",
        record: desire(30),
      }),
    );
    act(() => {
      setDesires([["alice", desire(20)]]);
      dispatchLive({
        type: "desires",
        characterId: "alice",
        record: desire(15),
      });
    });
    expect(result.current.desire?.anchorAt).toBe(30);
    expect(render).toHaveBeenCalledTimes(2);
    act(() => setLocations([]));
    expect(result.current.location).toBeUndefined();
  });

  it("merges journal events without duplicates or assuming contiguous sequences", () => {
    for (const seq of [1, 3, 2, 3])
      dispatchLive({ type: "journal", event: event(seq) });
    expect(useLiveStore.getState().journalTail.map((e) => e.seq)).toEqual([
      1, 2, 3,
    ]);
  });

  it("preserves live changes and removals while snapshot requests are in flight", () => {
    const home = { placeId: "home", since: 0 };
    setStatuses([
      ["alice", idle],
      ["removed", idle],
    ]);
    setLocations([["alice", home]]);
    setDesires([["alice", desire(1)]]);
    const baseline = useLiveStore.getState();
    const thinking = { ...idle, brain: "thinking" as const };
    const road = { placeId: "road", since: 10 };
    setStatuses([
      ["alice", thinking],
      ["new", idle],
    ]);
    updateLocation("alice", road);
    updateDesire("alice", desire(2));
    setStatuses(
      [
        ["alice", idle],
        ["removed", idle],
      ],
      baseline.statuses,
    );
    setLocations(
      [
        ["alice", home],
        ["bob", home],
      ],
      baseline.locations,
    );
    setDesires([["alice", desire(1)]], baseline.desires);
    expect(useLiveStore.getState().statuses.get("alice")).toBe(thinking);
    expect(useLiveStore.getState().statuses.has("removed")).toBe(false);
    expect(useLiveStore.getState().statuses.has("new")).toBe(true);
    expect(useLiveStore.getState().locations.get("alice")).toBe(road);
    expect(useLiveStore.getState().locations.get("bob")).toBe(home);
    expect(useLiveStore.getState().desires.get("alice")?.anchorAt).toBe(2);
  });
});
