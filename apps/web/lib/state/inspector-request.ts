/**
 * "Show me the inspector" from places that select on purpose (e.g. tapping a
 * chat header). On narrow screens the shell reopens the inspector sheet even
 * when the selection itself didn't change.
 */
const listeners = new Set<() => void>();

export function requestInspector(): void {
  for (const listener of listeners) listener();
}

export function onInspectorRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/*
 * A selection made for the user rather than by them (opening a chat points
 * the inspector at it) updates a docked inspector but must not pop the sheet
 * over what they just opened. The mark lasts until the selection moves on.
 */
let quietKey: string | null = null;

export function markQuietSelection(key: string): void {
  quietKey = key;
}

export function isQuietSelection(key: string | null): boolean {
  return key !== null && key === quietKey;
}

export function settleQuietSelection(key: string | null): void {
  if (key !== quietKey) quietKey = null;
}

/*
 * A view that points the inspector at what it opens leaves a link's own
 * selection alone, but only for the page as it was loaded: once anyone has
 * navigated, opening something always shows it.
 */
const loadedSearch =
  typeof window === "undefined" ? null : window.location.search;
let linkHonored = false;

/** True once per page load, while the URL is still the link that named both. */
export function keepsLinkedSelection(param: string): boolean {
  if (linkHonored || loadedSearch === null) return false;
  linkHonored = true;
  if (window.location.search !== loadedSearch) return false;
  const params = new URLSearchParams(loadedSearch);
  return params.has(param) && params.has("sel");
}
