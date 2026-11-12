// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  dismissUpdate,
  resetPreferences,
  sanitizePreferences,
  setHuddleRendering,
  setObservedCollapsed,
  setSectionOpen,
  syncPreferences,
  toggleWatch,
  usePreferencesStore,
  useSectionOpen,
} from "./preferences-store";
import { setDraftChat, useChatDraftStore } from "./chat-draft";

describe("preferences-store actions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPreferences();
  });

  it("toggles watchlist entries in and out", () => {
    expect(usePreferencesStore.getState().watchlist).toEqual([]);

    toggleWatch("airi-kurimura");
    expect(usePreferencesStore.getState().watchlist).toEqual(["airi-kurimura"]);

    toggleWatch("kazusa-kyouyama");
    expect(usePreferencesStore.getState().watchlist).toEqual([
      "airi-kurimura",
      "kazusa-kyouyama",
    ]);

    toggleWatch("airi-kurimura");
    expect(usePreferencesStore.getState().watchlist).toEqual([
      "kazusa-kyouyama",
    ]);
  });

  it("remembers inspector section fold states", () => {
    expect(usePreferencesStore.getState().inspectorFolds).toEqual({});

    setSectionOpen("character.desires", false);
    expect(
      usePreferencesStore.getState().inspectorFolds["character.desires"],
    ).toBe(false);

    setSectionOpen("character.desires", true);
    expect(
      usePreferencesStore.getState().inspectorFolds["character.desires"],
    ).toBe(true);
  });

  it("toggles observed section collapsed state", () => {
    expect(usePreferencesStore.getState().observedCollapsed).toBe(false);

    setObservedCollapsed(true);
    expect(usePreferencesStore.getState().observedCollapsed).toBe(true);

    setObservedCollapsed(false);
    expect(usePreferencesStore.getState().observedCollapsed).toBe(false);
  });

  it("sets dismissed update version", () => {
    expect(usePreferencesStore.getState().dismissedUpdateVersion).toBeNull();

    dismissUpdate("1.2.3");
    expect(usePreferencesStore.getState().dismissedUpdateVersion).toBe("1.2.3");
  });

  it("remembers how huddles open, a scene by default", () => {
    expect(usePreferencesStore.getState().huddleRendering).toBe("scene");

    setHuddleRendering("list");
    expect(usePreferencesStore.getState().huddleRendering).toBe("list");
  });
});

describe("sanitizePreferences", () => {
  it("sanitizes corrupt or non-array watchlist", () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences("invalid")).toEqual(DEFAULT_PREFERENCES);
    expect(
      sanitizePreferences({ watchlist: "not an array" }).watchlist,
    ).toEqual([]);
    expect(
      sanitizePreferences({ watchlist: ["valid", 123, null, "also-valid"] })
        .watchlist,
    ).toEqual(["valid", "also-valid"]);
  });

  it("sanitizes corrupt inspector folds", () => {
    expect(
      sanitizePreferences({ inspectorFolds: "not an object" }).inspectorFolds,
    ).toEqual({});
    expect(
      sanitizePreferences({ inspectorFolds: ["not", "an", "object"] })
        .inspectorFolds,
    ).toEqual({});
    expect(
      sanitizePreferences({
        inspectorFolds: {
          validSection: true,
          invalidSection: "not-boolean",
          numSection: 1,
        },
      }).inspectorFolds,
    ).toEqual({ validSection: true });
  });

  it("sanitizes observed collapsed and dismissed version", () => {
    expect(
      sanitizePreferences({ observedCollapsed: "yes" }).observedCollapsed,
    ).toBe(false);
    expect(
      sanitizePreferences({ observedCollapsed: true }).observedCollapsed,
    ).toBe(true);

    expect(
      sanitizePreferences({ dismissedUpdateVersion: 12345 })
        .dismissedUpdateVersion,
    ).toBeNull();
    expect(
      sanitizePreferences({ dismissedUpdateVersion: "2026.11.08" })
        .dismissedUpdateVersion,
    ).toBe("2026.11.08");
  });

  it("sanitizes how huddles open", () => {
    expect(
      sanitizePreferences({ huddleRendering: "canvas" }).huddleRendering,
    ).toBe("scene");
    expect(
      sanitizePreferences({ huddleRendering: "list" }).huddleRendering,
    ).toBe("list");
  });
});

describe("preferences-store persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPreferences();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("restores the current persisted preferences", async () => {
    window.localStorage.setItem(
      "kazusa:preferences",
      JSON.stringify({
        version: 1,
        state: {
          watchlist: ["alice"],
          inspectorFolds: { "character.desires": false },
          observedCollapsed: true,
          dismissedUpdateVersion: "1.2.3",
          huddleRendering: "list",
        },
      }),
    );
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState()).toEqual({
      watchlist: ["alice"],
      inspectorFolds: { "character.desires": false },
      observedCollapsed: true,
      dismissedUpdateVersion: "1.2.3",
      huddleRendering: "list",
    });

    toggleWatch("bob");
    expect(
      JSON.parse(window.localStorage.getItem("kazusa:preferences") ?? "null")
        .state.watchlist,
    ).toEqual(["alice", "bob"]);
  });

  it("keeps defaults when stored JSON is corrupt", async () => {
    window.localStorage.setItem("kazusa:preferences", "{");
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState()).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps preferences usable when storage is full or blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    expect(() => toggleWatch("alice")).not.toThrow();
    expect(usePreferencesStore.getState().watchlist).toEqual(["alice"]);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    await usePreferencesStore.persist.rehydrate();
    expect(usePreferencesStore.getState().watchlist).toEqual(["alice"]);
  });

  it("does not rerender an inspector section when another preference changes", () => {
    const renders = vi.fn();
    const section = renderHook(() => {
      renders();
      return useSectionOpen("character.desires", true);
    });
    act(() => toggleWatch("alice"));
    act(() => setSectionOpen("character.about", false));
    expect(renders).toHaveBeenCalledOnce();
    act(() => setSectionOpen("character.desires", false));
    expect(section.result.current).toBe(false);
    expect(renders).toHaveBeenCalledTimes(2);
  });
});

describe("preferences across tabs", () => {
  const storageKey = "kazusa:preferences";

  function remoteWrite(state: typeof DEFAULT_PREFERENCES): void {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ state, version: 1 }),
    );
  }

  function storageEvent(
    key: string | null = storageKey,
    storageArea: Storage = window.localStorage,
  ): void {
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea }));
  }

  function useSyncPreferences(): void {
    useEffect(syncPreferences, []);
  }

  beforeEach(() => {
    window.localStorage.clear();
    resetPreferences();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("retains another tab's watchlist when this tab folds an inspector section", () => {
    renderHook(useSyncPreferences, { wrapper: StrictMode });
    remoteWrite({ ...DEFAULT_PREFERENCES, watchlist: ["airi-kurimura"] });
    act(() => storageEvent());

    setSectionOpen("character.desires", false);
    expect(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
    ).toEqual({
      version: 1,
      state: {
        ...DEFAULT_PREFERENCES,
        watchlist: ["airi-kurimura"],
        inspectorFolds: { "character.desires": false },
      },
    });
  });

  it("hydrates changes made before mounting without writing them back", () => {
    remoteWrite({ ...DEFAULT_PREFERENCES, watchlist: ["alice"] });
    const writes = vi.spyOn(Storage.prototype, "setItem");
    renderHook(useSyncPreferences, { wrapper: StrictMode });

    expect(usePreferencesStore.getState().watchlist).toEqual(["alice"]);
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([storageKey, null])(
    "resets deleted preferences without echoing a write for storage key %s",
    (key) => {
      renderHook(useSyncPreferences);
      toggleWatch("alice");
      if (key === null) window.localStorage.clear();
      else window.localStorage.removeItem(storageKey);
      const writes = vi.spyOn(Storage.prototype, "setItem");

      act(() => storageEvent(key));
      expect(usePreferencesStore.getState()).toEqual(DEFAULT_PREFERENCES);
      expect(window.localStorage.getItem(storageKey)).toBeNull();
      expect(writes).not.toHaveBeenCalled();
    },
  );

  it("only listens to relevant local-storage events and releases its listener", () => {
    const view = renderHook(useSyncPreferences, { wrapper: StrictMode });
    const rehydrate = vi.spyOn(usePreferencesStore.persist, "rehydrate");
    storageEvent("unrelated");
    storageEvent(storageKey, window.sessionStorage);
    expect(rehydrate).not.toHaveBeenCalled();

    remoteWrite({ ...DEFAULT_PREFERENCES, watchlist: ["alice"] });
    act(() => storageEvent());
    expect(rehydrate).toHaveBeenCalledOnce();
    expect(usePreferencesStore.getState().watchlist).toEqual(["alice"]);

    view.unmount();
    storageEvent();
    expect(rehydrate).toHaveBeenCalledOnce();
  });

  it("keeps in-memory preferences when localStorage access is blocked", () => {
    toggleWatch("alice");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    expect(() => {
      const stop = syncPreferences();
      stop();
    }).not.toThrow();
    expect(usePreferencesStore.getState().watchlist).toEqual(["alice"]);
  });
});

describe("chat-draft", () => {
  beforeEach(() => {
    useChatDraftStore.setState({ draft: null });
  });

  it("manages draft chat state", () => {
    expect(useChatDraftStore.getState().draft).toBeNull();

    const mockChat = {
      id: "draft:123",
      name: "New Group",
      type: "group" as const,
      members: ["user:sensei", "airi-kurimura"],
      draft: true,
      unreadCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionKey: "session:draft",
    };

    setDraftChat(mockChat);
    expect(useChatDraftStore.getState().draft).toEqual(mockChat);

    setDraftChat(null);
    expect(useChatDraftStore.getState().draft).toBeNull();
  });
});
