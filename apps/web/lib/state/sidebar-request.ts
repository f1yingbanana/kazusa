/**
 * "Show me this section's sidebar" from inside a stage view (e.g. the
 * Timeline's Filters button). Below `lg` the shell opens it as a sheet; on
 * wider screens the sidebar is already visible and nothing happens.
 */
const listeners = new Set<() => void>();

export function requestSidebar(): void {
  for (const listener of listeners) listener();
}

export function onSidebarRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
