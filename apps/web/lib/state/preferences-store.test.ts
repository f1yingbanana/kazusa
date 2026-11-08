// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  dismissUpdate,
  resetPreferences,
  sanitizePreferences,
  setObservedCollapsed,
  setSectionOpen,
  toggleWatch,
  usePreferencesStore,
} from "./preferences-store";
import { DEFAULT_CONFIG, saveConfig, useConfigStore } from "./config-store";
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
});

describe("preferences-store legacy migration and persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPreferences();
  });

  it("migrates legacy keys when unified key is missing and deletes legacy keys upon save", async () => {
    window.localStorage.removeItem("kazusa:preferences");
    window.localStorage.setItem(
      "kazusa:watchlist",
      JSON.stringify(["airi-kurimura", "hifumi-ajitani"]),
    );
    window.localStorage.setItem(
      "kazusa:inspector-folds",
      JSON.stringify({ "character.desires": false }),
    );
    window.localStorage.setItem("kazusa:observed-collapsed", "1");
    window.localStorage.setItem("kazusa:update-dismissed", "1.0.0");

    // Rehydrate from storage adapter
    await usePreferencesStore.persist.rehydrate();

    const state = usePreferencesStore.getState();
    expect(state.watchlist).toEqual(["airi-kurimura", "hifumi-ajitani"]);
    expect(state.inspectorFolds).toEqual({ "character.desires": false });
    expect(state.observedCollapsed).toBe(true);
    expect(state.dismissedUpdateVersion).toBe("1.0.0");

    // Trigger a write
    toggleWatch("kazusa-kyouyama");

    // Unified key should be written
    const unifiedRaw = window.localStorage.getItem("kazusa:preferences");
    expect(unifiedRaw).not.toBeNull();
    const unified = JSON.parse(unifiedRaw!);
    expect(unified.state.watchlist).toContain("kazusa-kyouyama");

    // Legacy keys should be cleanly removed
    expect(window.localStorage.getItem("kazusa:watchlist")).toBeNull();
    expect(window.localStorage.getItem("kazusa:inspector-folds")).toBeNull();
    expect(window.localStorage.getItem("kazusa:observed-collapsed")).toBeNull();
    expect(window.localStorage.getItem("kazusa:update-dismissed")).toBeNull();
  });

  it("tolerates localStorage setItem quota exceeded errors gracefully", () => {
    const originalSetItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    try {
      expect(() => toggleWatch("airi-kurimura")).not.toThrow();
      expect(usePreferencesStore.getState().watchlist).toEqual([
        "airi-kurimura",
      ]);
    } finally {
      window.localStorage.setItem = originalSetItem;
    }
  });
});

describe("config-store", () => {
  beforeEach(() => {
    useConfigStore.setState({ config: DEFAULT_CONFIG });
  });

  it("updates and retrieves player configuration", () => {
    expect(useConfigStore.getState().config.userId).toBe("user:you");

    saveConfig({ userId: "user:sensei", userName: "Sensei" });
    expect(useConfigStore.getState().config).toEqual({
      userId: "user:sensei",
      userName: "Sensei",
    });
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
