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
