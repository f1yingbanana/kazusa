import { create } from "zustand";
import { createLoader, parseAsString } from "nuqs/server";
import type { EntityKind } from "./entity-ref";

interface UiState {
  readonly sidebarOpen: boolean;
  readonly inspectorRequested: boolean;
  /**
   * The inspector's open tabs: the last character, place and chat selected, one
   * of each, kept while the selection moves on.
   */
  readonly inspectorTabs: Partial<Record<EntityKind, string>>;
  /** The tab shown: one of those, or You, the character played. */
  readonly inspectorTab: "you" | EntityKind;
  /** The Play as dialog. */
  /** `pick`: who the dialog starts on, instead of whoever is played now. */
  readonly playDialog: { readonly open: boolean; readonly pick?: string };
  /** What a visitor is told on arriving, and can open again. */
  readonly visitorWelcome: { readonly open: boolean };
  /** Asking whether to save before the system agent updates the world. */
  readonly updateSaveDialog: { readonly open: boolean };
  readonly quietKey: string | null;
  readonly dismissedFailures: ReadonlySet<string>;
}

const loadedSearch =
  typeof window === "undefined" ? null : window.location.search;
let linkHonored = false;

export const useUiStore = create<UiState>()(() => ({
  sidebarOpen: false,
  inspectorRequested: false,
  inspectorTabs: {},
  inspectorTab: "character",
  playDialog: { open: false },
  visitorWelcome: { open: false },
  updateSaveDialog: { open: false },
  quietKey: null,
  dismissedFailures: new Set(),
}));

export function setSidebarOpen(sidebarOpen: boolean): void {
  useUiStore.setState({ sidebarOpen });
}

export function dismissFailures(keys: readonly string[]): void {
  useUiStore.setState((state) => ({
    dismissedFailures: new Set([...state.dismissedFailures, ...keys]),
  }));
}

/** A section can open its sidebar sheet on narrow screens. */
export function requestSidebar(): void {
  setSidebarOpen(true);
}

/** Explicit selection reopens the inspector even if the URL didn't change. */
export function requestInspector(): void {
  useUiStore.setState({ inspectorRequested: true });
}

export function setInspectorTab(inspectorTab: "you" | EntityKind): void {
  useUiStore.setState({ inspectorTab });
}

/** Something selected opens, or takes over, its kind's tab, and shows it. */
export function openInspectorTab(kind: EntityKind, id: string): void {
  useUiStore.setState((state) => ({
    inspectorTabs: { ...state.inspectorTabs, [kind]: id },
    inspectorTab: kind,
  }));
}

/** Closes one kind's tab. */
export function closeInspectorTab(kind: EntityKind): void {
  useUiStore.setState((state) => {
    const { [kind]: _closed, ...rest } = state.inspectorTabs;
    return { inspectorTabs: rest };
  });
}

export function openPlayDialog(pick?: string): void {
  useUiStore.setState({
    playDialog: pick ? { open: true, pick } : { open: true },
  });
}

export function closePlayDialog(): void {
  useUiStore.setState({ playDialog: { open: false } });
}

export function openVisitorWelcome(): void {
  useUiStore.setState({ visitorWelcome: { open: true } });
}

export function closeVisitorWelcome(): void {
  useUiStore.setState({ visitorWelcome: { open: false } });
}

export function openUpdateSaveDialog(): void {
  useUiStore.setState({ updateSaveDialog: { open: true } });
}

export function closeUpdateSaveDialog(): void {
  useUiStore.setState({ updateSaveDialog: { open: false } });
}

export function clearInspectorRequest(): void {
  useUiStore.setState({ inspectorRequested: false });
}

/** Automatic selection updates a docked inspector without opening a sheet. */
export function markQuietSelection(quietKey: string): void {
  useUiStore.setState({ quietKey });
}

export function settleQuietSelection(key: string | null): void {
  if (key !== useUiStore.getState().quietKey)
    useUiStore.setState({ quietKey: null });
}

/** Honor a deep link's explicit inspector selection once, before navigation. */
export function keepsLinkedSelection(param: string): boolean {
  if (linkHonored || loadedSearch === null) return false;
  linkHonored = true;
  if (window.location.search !== loadedSearch) return false;
  const params = createLoader({ [param]: parseAsString, sel: parseAsString })(
    loadedSearch,
  );
  return params[param] !== null && params.sel !== null;
}
