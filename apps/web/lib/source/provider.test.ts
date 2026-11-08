// @vitest-environment jsdom
import { createElement, StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig, useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CharacterSummary,
  LocationsResponse,
  WorldResponse,
} from "@kazusa/client";
import { SourcesProvider, useSources } from "./provider";
import { useCharacterStatus } from "../../hooks/use-characters";
import { updateLocation, useLiveStore } from "../live/state";
import { useClockStore } from "../live/clock-state";
import { fetchWorld } from "./clock/http";
import { fetchCharacters } from "./characters/http";
import { fetchLocations } from "./location/http";

vi.mock("./clock/http", () => ({ fetchWorld: vi.fn() }));
vi.mock("./characters/http", () => ({ fetchCharacters: vi.fn() }));
vi.mock("./location/http", async (original) => ({
  ...(await original<typeof import("./location/http")>()),
  fetchLocations: vi.fn(),
}));

const world: WorldResponse = {
  user: { id: "user:owner", name: "Owner" },
  serverNow: 1000,
  clock: { simTime: 60_000, speed: 0, updatedAt: 1000 },
  world: { title: "Test world" },
  capabilities: {
    characters: "live",
    status: "live",
    location: "live",
    clock: "live",
  },
};
const roster: CharacterSummary[] = [
  {
    id: "alice",
    name: "Alice",
    kind: "agent",
    aliases: [],
    status: { brain: "idle", composingIn: [], queued: 0, onstage: true },
  },
];

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
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
      createElement(SourcesProvider, { fallback: null, children }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useLiveStore.setState(useLiveStore.getInitialState(), true);
  useClockStore.setState(useClockStore.getInitialState(), true);
  vi.mocked(fetchWorld).mockImplementation(async () => structuredClone(world));
  vi.mocked(fetchCharacters).mockImplementation(async () =>
    structuredClone(roster),
  );
  vi.mocked(fetchLocations).mockResolvedValue({ records: {} });
});
afterEach(cleanup);

describe("source snapshot lifecycle", () => {
  it("preserves live updates received while the initial snapshot is in flight in StrictMode", async () => {
    const request = deferred<LocationsResponse>();
    vi.mocked(fetchLocations).mockReturnValue(request.promise);
    renderHook(useSources, { wrapper });
    await waitFor(() => expect(fetchLocations).toHaveBeenCalledOnce());
    const newest = { placeId: "library", since: 2 };
    act(() => updateLocation("alice", newest));
    await act(async () =>
      request.resolve({
        records: {
          alice: { placeId: "home", since: 1 },
          bob: { placeId: "home", since: 1 },
        },
      }),
    );
    expect(useLiveStore.getState().locations.get("alice")).toBe(newest);
    expect(useLiveStore.getState().locations.get("bob")?.placeId).toBe("home");
    expect(useClockStore.getState().clock?.clock.simTime).toBe(60_000);
  });

  it("keeps cached resources available after a transient world revalidation error", async () => {
    const { result } = renderHook(
      () => ({ sources: useSources(), mutate: useSWRConfig().mutate }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current?.sources.resolved.characters).toBe("live"),
    );
    vi.mocked(fetchWorld).mockRejectedValueOnce(
      new Error("Gateway restarting"),
    );
    await act(async () => {
      await result.current.mutate(["kazusa/world"]).catch(() => undefined);
    });
    expect(result.current.sources.reachable).toBe(false);
    expect(result.current.sources.resolved.characters).toBe("live");
    expect(result.current.sources.player).toEqual(world.user);
    expect(result.current.sources.backendError?.message).toBe(
      "Gateway restarting",
    );
  });

  it("does not repopulate a disabled domain from an older in-flight request", async () => {
    const request = deferred<LocationsResponse>();
    vi.mocked(fetchLocations).mockReturnValue(request.promise);
    const { result } = renderHook(
      () => ({ sources: useSources(), mutate: useSWRConfig().mutate }),
      { wrapper },
    );
    await waitFor(() => expect(fetchLocations).toHaveBeenCalledOnce());
    vi.mocked(fetchWorld).mockResolvedValue({
      ...world,
      capabilities: { ...world.capabilities, location: "unavailable" },
    });
    await act(async () => {
      await result.current.mutate(["kazusa/world"]);
    });
    expect(result.current.sources.resolved.location).toBe("unavailable");
    await act(async () =>
      request.resolve({ records: { alice: { placeId: "home", since: 1 } } }),
    );
    expect(useLiveStore.getState().locations.size).toBe(0);
  });

  it("does not restore the clock from a superseded world request", async () => {
    const { result } = renderHook(
      () => ({ sources: useSources(), mutate: useSWRConfig().mutate }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current?.sources.resolved.clock).toBe("live"),
    );
    const older = deferred<WorldResponse>();
    const newer = deferred<WorldResponse>();
    vi.mocked(fetchWorld)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.mutate(["kazusa/world"]);
    });
    act(() => {
      second = result.current.mutate(["kazusa/world"]);
    });
    await act(async () => {
      newer.resolve({
        ...world,
        capabilities: { ...world.capabilities, clock: "unavailable" },
      });
      await second;
    });
    expect(useClockStore.getState().clock).toBeNull();
    await act(async () => {
      older.resolve(world);
      await first;
    });
    expect(result.current.sources.resolved.clock).toBe("unavailable");
    expect(useClockStore.getState().clock).toBeNull();
  });

  it("does not rerender character selectors when a refreshed snapshot is unchanged", async () => {
    const renders = vi.fn();
    const { result } = renderHook(
      () => {
        renders();
        return {
          status: useCharacterStatus("alice"),
          mutate: useSWRConfig().mutate,
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current?.status?.brain).toBe("idle"));
    const before = renders.mock.calls.length;
    await act(async () => {
      await result.current.mutate(["kazusa/characters"]);
    });
    expect(fetchCharacters).toHaveBeenCalledTimes(2);
    expect(renders).toHaveBeenCalledTimes(before);
  });
});
