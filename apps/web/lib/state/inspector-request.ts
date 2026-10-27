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
