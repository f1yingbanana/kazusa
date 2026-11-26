import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";
export type PaletteId = "sky" | "crimson" | "cyan" | "sand";

const THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);
const PALETTE_IDS = new Set<PaletteId>(["sky", "crimson", "cyan", "sand"]);

export interface PreferencesState {
  readonly watchlist: readonly string[];
  readonly inspectorFolds: Readonly<Record<string, boolean>>;
  readonly observedCollapsed: boolean;
  readonly dismissedUpdateVersion: string | null;
  /**
   * How huddles open when the link doesn't say (`chats.as`): as a scene (with
   * or without art) or as the transcript.
   */
  readonly huddleRendering: "scene" | "list";
  readonly themeMode: ThemeMode;
  readonly palette: PaletteId;
}

export const DEFAULT_PREFERENCES: PreferencesState = {
  watchlist: [],
  inspectorFolds: {},
  observedCollapsed: false,
  dismissedUpdateVersion: null,
  huddleRendering: "scene",
  themeMode: "system",
  palette: "sky",
};

const STORAGE_KEY = "kazusa:preferences";

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

  const huddleRendering =
    obj.huddleRendering === "scene" || obj.huddleRendering === "list"
      ? obj.huddleRendering
      : DEFAULT_PREFERENCES.huddleRendering;

  const themeMode =
    typeof obj.themeMode === "string" &&
    THEME_MODES.has(obj.themeMode as ThemeMode)
      ? (obj.themeMode as ThemeMode)
      : DEFAULT_PREFERENCES.themeMode;

  const palette =
    typeof obj.palette === "string" && PALETTE_IDS.has(obj.palette as PaletteId)
      ? (obj.palette as PaletteId)
      : DEFAULT_PREFERENCES.palette;

  return {
    watchlist,
    inspectorFolds,
    observedCollapsed,
    dismissedUpdateVersion,
    huddleRendering,
    themeMode,
    palette,
  };
}

/** Keep preferences usable in memory when browser storage is unavailable. */
const preferencesStorage: StateStorage = {
  // Persist catches read failures and retains the in-memory state. A missing
  // value, unlike a failed read, means another tab may have cleared preferences.
  getItem: (name) => window.localStorage.getItem(name),
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Storage may be blocked or full.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Storage may be blocked.
    }
  },
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(() => DEFAULT_PREFERENCES, {
    name: STORAGE_KEY,
    version: 1,
    storage: createJSONStorage(() => preferencesStorage),
    merge: (persistedState) => sanitizePreferences(persistedState),
  }),
);

/** Keep mounted tabs current before their next preference edit. */
export function syncPreferences(): () => void {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return () => undefined;
  }
  const onStorage = (event: StorageEvent): void => {
    if (
      event.storageArea === storage &&
      (event.key === STORAGE_KEY || event.key === null)
    ) {
      void usePreferencesStore.persist.rehydrate();
    }
  };
  window.addEventListener("storage", onStorage);
  // A different tab may have written since the module's initial hydration.
  void usePreferencesStore.persist.rehydrate();
  return () => window.removeEventListener("storage", onStorage);
}

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

export function setHuddleRendering(rendering: "scene" | "list"): void {
  usePreferencesStore.setState({ huddleRendering: rendering });
}

export function setThemeMode(themeMode: ThemeMode): void {
  usePreferencesStore.setState({ themeMode });
}

export function setPalette(palette: PaletteId): void {
  usePreferencesStore.setState({ palette });
}

export function resetPreferences(): void {
  usePreferencesStore.setState(DEFAULT_PREFERENCES, true);
}

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

export function useHuddleRendering(): "scene" | "list" {
  return usePreferencesStore((state) => state.huddleRendering);
}

export function useThemeMode(): ThemeMode {
  return usePreferencesStore((state) => state.themeMode);
}

export function usePalettePreference(): PaletteId {
  return usePreferencesStore((state) => state.palette);
}
