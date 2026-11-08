import { create } from "zustand";
import { createLoader, parseAsString } from "nuqs/server";

interface UiState {
  readonly sidebarOpen: boolean;
  readonly inspectorRequested: boolean;
  readonly quietKey: string | null;
  readonly dismissedFailures: ReadonlySet<string>;
}

const loadedSearch =
  typeof window === "undefined" ? null : window.location.search;
let linkHonored = false;

export const useUiStore = create<UiState>()(() => ({
  sidebarOpen: false,
  inspectorRequested: false,
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
