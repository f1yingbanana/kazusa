"use client";

import { useSyncExternalStore } from "react";
import type { Chat } from "../source/chats/types";

/**
 * The one not-yet-sent chat (a new DM or group). Shared because the sidebar
 * creates groups while the Chats stage view renders them.
 */
let draft: Chat | null = null;
const listeners = new Set<() => void>();

export function setDraftChat(next: Chat | null): void {
  if (draft === next) return;
  draft = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDraftChat(): Chat | null {
  return useSyncExternalStore(
    subscribe,
    () => draft,
    () => null,
  );
}
