"use client";

import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

export interface PreferencesState {
  readonly watchlist: readonly string[];
  readonly inspectorFolds: Readonly<Record<string, boolean>>;
  readonly observedCollapsed: boolean;
  readonly dismissedUpdateVersion: string | null;
}

export const DEFAULT_PREFERENCES: PreferencesState = {
  watchlist: [],
  inspectorFolds: {},
  observedCollapsed: false,
  dismissedUpdateVersion: null,
};

const STORAGE_KEY = "kazusa:preferences";
const LEGACY_KEYS = [
  "kazusa:watchlist",
  "kazusa:inspector-folds",
  "kazusa:observed-collapsed",
  "kazusa:update-dismissed",
] as const;

/**
 * Validates and sanitizes raw data read from storage, discarding corrupted or
 * malformed fields and falling back to safe defaults.
 */
export function sanitizePreferences(raw: unknown): PreferencesState {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_PREFERENCES;
  }
  const obj = raw as Partial<Record<keyof PreferencesState, unknown>>;

  const watchlist = Array.isArray(obj.watchlist)
    ? obj.watchlist.filter((item): item is string => typeof item === "string")
    : DEFAULT_PREFERENCES.watchlist;

  let inspectorFolds = DEFAULT_PREFERENCES.inspectorFolds;
  if (
    obj.inspectorFolds &&
    typeof obj.inspectorFolds === "object" &&
    !Array.isArray(obj.inspectorFolds)
  ) {
    inspectorFolds = Object.fromEntries(
      Object.entries(obj.inspectorFolds).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  }

  const observedCollapsed =
    typeof obj.observedCollapsed === "boolean"
      ? obj.observedCollapsed
      : DEFAULT_PREFERENCES.observedCollapsed;

  const dismissedUpdateVersion =
    typeof obj.dismissedUpdateVersion === "string"
      ? obj.dismissedUpdateVersion
      : DEFAULT_PREFERENCES.dismissedUpdateVersion;

  return {
    watchlist,
    inspectorFolds,
    observedCollapsed,
    dismissedUpdateVersion,
  };
}

/**
 * Migrates legacy localStorage keys if the unified preferences key does not yet exist.
 */
function readLegacyPreferences(): PreferencesState | null {
  if (typeof window === "undefined") return null;

  let hasLegacy = false;
  let watchlist: unknown;
  let inspectorFolds: unknown;
  let observedCollapsed: unknown;
  let dismissedUpdateVersion: unknown;

  try {
    const rawWatch = window.localStorage.getItem("kazusa:watchlist");
    if (rawWatch !== null) {
      hasLegacy = true;
      try {
        watchlist = JSON.parse(rawWatch);
      } catch {
        // Corrupt JSON.
      }
    }

    const rawFolds = window.localStorage.getItem("kazusa:inspector-folds");
    if (rawFolds !== null) {
      hasLegacy = true;
      try {
        inspectorFolds = JSON.parse(rawFolds);
      } catch {
        // Corrupt JSON.
      }
    }

    const rawObserved = window.localStorage.getItem("kazusa:observed-collapsed");
    if (rawObserved !== null) {
      hasLegacy = true;
      observedCollapsed = rawObserved === "1";
    }

    const rawDismissed = window.localStorage.getItem("kazusa:update-dismissed");
    if (rawDismissed !== null) {
      hasLegacy = true;
      dismissedUpdateVersion = rawDismissed;
    }
  } catch {
    // Storage blocked.
  }

  if (!hasLegacy) return null;

  return sanitizePreferences({
    watchlist,
    inspectorFolds,
    observedCollapsed,
    dismissedUpdateVersion,
  });
}

let hasLegacyToClean = false;

function cleanLegacyKeys(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage access blocked.
    }
  }
}

/**
 * Custom StateStorage adapter that:
 * 1. Checks and migrates legacy keys on initial getItem when kazusa:preferences is missing.
 * 2. Catches and suppresses setItem errors (e.g. QuotaExceededError or private browsing).
 * 3. Removes legacy keys once on the first write to kazusa:preferences after migration.
 */
const preferencesStorageAdapter: StateStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(name);
      if (stored !== null) return stored;

      // Unified entry is missing; check for legacy entries to migrate.
      const legacy = readLegacyPreferences();
      if (legacy) {
        hasLegacyToClean = true;
        return JSON.stringify({ state: legacy, version: 1 });
      }
      return null;
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
      if (hasLegacyToClean) {
        hasLegacyToClean = false;
        cleanLegacyKeys();
      }
    } catch {
      // Storage quota exceeded or disabled; fail gracefully without crashing.
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Storage access blocked.
    }
  },
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(() => DEFAULT_PREFERENCES, {
    name: STORAGE_KEY,
    version: 1,
    storage: createJSONStorage(() => preferencesStorageAdapter),
    merge: (persistedState, currentState) => ({
      ...currentState,
      ...sanitizePreferences(persistedState),
    }),
  }),
);

/* -------------------------------------------------------------------------- */
/* Standalone Action Functions (Zustand idiomatic "no store actions" pattern)   */
/* -------------------------------------------------------------------------- */

export function toggleWatch(id: string): void {
  usePreferencesStore.setState((state) => ({
    watchlist: state.watchlist.includes(id)
      ? state.watchlist.filter((x) => x !== id)
      : [...state.watchlist, id],
  }));
}

export function setSectionOpen(id: string, open: boolean): void {
  usePreferencesStore.setState((state) => ({
    inspectorFolds: { ...state.inspectorFolds, [id]: open },
  }));
}

export function setObservedCollapsed(collapsed: boolean): void {
  usePreferencesStore.setState({ observedCollapsed: collapsed });
}

export function dismissUpdate(version: string): void {
  usePreferencesStore.setState({ dismissedUpdateVersion: version });
}

export function resetPreferences(): void {
  hasLegacyToClean = false;
  usePreferencesStore.setState(DEFAULT_PREFERENCES, true);
}

/* -------------------------------------------------------------------------- */
/* Selector Hooks                                                             */
/* -------------------------------------------------------------------------- */

export function useWatchlist(): readonly string[] {
  return usePreferencesStore((state) => state.watchlist);
}

export function useSectionOpen(id: string, fallback: boolean): boolean {
  return usePreferencesStore((state) => state.inspectorFolds[id] ?? fallback);
}

export function useObservedCollapsed(): boolean {
  return usePreferencesStore((state) => state.observedCollapsed);
}

export function useDismissedUpdateVersion(): string | null {
  return usePreferencesStore((state) => state.dismissedUpdateVersion);
}
